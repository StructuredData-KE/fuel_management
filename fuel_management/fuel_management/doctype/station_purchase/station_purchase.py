# -*- coding: utf-8 -*-
import frappe
from frappe.model.document import Document

class StationPurchase(Document):
    def validate(self):
        from frappe.utils import flt
        grand_total = 0
        for item in self.items:
            item.total_cost = flt(item.quantity) * flt(item.unit_cost)
            vat_rate = flt(getattr(item, "vat_rate", 0))
            
            if getattr(item, "vat_inclusive", False):
                item.net_total = item.total_cost / (1 + (vat_rate / 100))
                item_grand = item.total_cost
            else:
                item.net_total = item.total_cost
                item_grand = item.total_cost * (1 + (vat_rate / 100))
                
            grand_total += item_grand
            
        self.grand_total = grand_total + flt(self.transport_charge)

    def after_insert(self):
        self.create_purchase_invoice()

    def create_purchase_invoice(self):
        pi = frappe.new_doc("Purchase Invoice")
        pi.supplier = self.supplier
        pi.posting_date = self.document_date or self.receiving_date or frappe.utils.nowdate()
        pi.posting_time = frappe.utils.nowtime()
        pi.set_posting_time = 1
        pi.update_stock = 1
        pi.bill_no = self.document_invoice_number
        pi.custom_kra_invoice_number = self.tax_invoice_number
        
        for item in self.items:
            company = frappe.defaults.get_user_default("Company")
            expense_account = frappe.db.get_value("Item Default", {"parent": item.item, "company": company}, "expense_account")
            if not expense_account:
                expense_account = frappe.get_cached_value("Company", company, "default_expense_account") or "Cost of Goods Sold"

            pi_item = {
                "item_code": item.item,
                "qty": item.quantity,
                "rate": item.unit_cost,
                "warehouse": item.target_location,
                "received_qty": item.quantity,
                "expense_account": expense_account
            }
            # Custom logic to map target_tank if added to Purchase Invoice Item in future
            if getattr(item, "target_tank", None):
                pi_item["custom_target_tank"] = item.target_tank
            if getattr(item, "uom", None):
                pi_item["uom"] = item.uom
                
            pi.append("items", pi_item)
            
        if self.transport_charge and self.transport_charge > 0:
            item_code = "Transport Charge"
            if not frappe.db.exists("Item", item_code):
                try:
                    frappe.get_doc({
                        "doctype": "Item",
                        "item_code": item_code,
                        "item_name": "Transport Charge",
                        "item_group": "Services",
                        "is_stock_item": 0,
                        "is_fixed_asset": 0,
                        "stock_uom": "Nos"
                    }).insert(ignore_permissions=True)
                except Exception:
                    # Fallback if Services doesn't exist
                    try:
                        frappe.get_doc({
                            "doctype": "Item",
                            "item_code": item_code,
                            "item_name": "Transport Charge",
                            "item_group": "All Item Groups",
                            "is_stock_item": 0,
                            "is_fixed_asset": 0,
                            "stock_uom": "Nos"
                        }).insert(ignore_permissions=True)
                    except Exception:
                        pass
                        
            company = frappe.defaults.get_user_default("Company")
            expense_account = frappe.db.get_value("Item Default", {"parent": item_code, "company": company}, "expense_account")
            if not expense_account:
                expense_account = frappe.get_cached_value("Company", company, "default_expense_account") or "Cost of Goods Sold"

            pi.append("items", {
                "item_code": item_code,
                "warehouse": self.items[0].target_location if self.items else None,
                "item_name": "Transport Charge",
                "description": "Transport Charge",
                "qty": 1,
                "rate": self.transport_charge,
                "expense_account": expense_account
            })
        

        pi.flags.ignore_permissions = True
        pi.insert()
        pi.submit()
        
        # Update tank volume
        for item in self.items:
            if getattr(item, "target_tank", None):
                try:
                    tank = frappe.get_doc("Fuel Tank", item.target_tank)
                    if tank.current_volume is None:
                        tank.current_volume = 0
                    tank.current_volume += item.quantity
                    tank.flags.ignore_permissions = True
                    tank.save()
                except Exception as e:
                    frappe.log_error("Failed to update Fuel Tank volume: " + str(e))
        
        # Suppress auto-generated warning messages about Expense Head changing
        if hasattr(frappe, "message_log"):
            frappe.message_log = []
        
        frappe.msgprint(f"Generated Purchase Invoice {pi.name}")

@frappe.whitelist()
def get_purchases_history(date_from=None, date_to=None):
    filters = {}
    if date_from and date_to:
        filters['receiving_date'] = ['between', [date_from, date_to]]
    elif date_from:
        filters['receiving_date'] = ['>=', date_from]
    elif date_to:
        filters['receiving_date'] = ['<=', date_to]
    
    purchases = frappe.get_all('Station Purchase', filters=filters, fields=['name', 'receiving_date', 'supplier', 'tax_invoice_number', 'document_invoice_number', 'grand_total'], order_by='name desc', limit_page_length=50)
    
    for p in purchases:
        p.items = frappe.get_all('Station Purchase Item', filters={'parent': p.name}, fields=['item', 'quantity'])
    
    return purchases


# -*- coding: utf-8 -*-
import frappe
from frappe.model.document import Document

class StationPurchase(Document):
    def validate(self):
        from frappe.utils import flt
        grand_total = 0
        net_total = 0
        total_vat = 0

        # Cache warehouses for default target location fallback
        forecourt_wh = frappe.db.get_value("Warehouse", {"warehouse_name": ["like", "%Forecourt%"], "is_group": 0, "disabled": 0}, "name")
        store_wh = frappe.db.get_value("Warehouse", {"warehouse_name": ["like", "%Store%"], "is_group": 0, "disabled": 0}, "name")

        for item in self.items:
            item_info = frappe.db.get_value("Item", item.item, ["item_group", "item_name"], as_dict=True) or {}
            group = (item_info.get("item_group") or "").upper()
            name = (item_info.get("item_name") or item.item or "").upper()

            is_fuel = "FUEL" in group or "PETROL" in name or "DIESEL" in name or "KEROSENE" in name or "AGO" in name or "PMS" in name or "IK" in name
            is_gas = "GAS" in group or "CYLINDER" in group or "GAS" in name or "CYLINDER" in name or "LPG" in name or "6KG" in name or "13KG" in name or "35KG" in name or "50KG" in name

            # Target location auto-fallback
            if not getattr(item, "target_location", None):
                if is_fuel or is_gas:
                    item.target_location = forecourt_wh
                else:
                    item.target_location = store_wh

            # VAT Rate auto-fallback if None
            if getattr(item, "vat_rate", None) is None:
                if is_fuel:
                    item.vat_rate = 8.0
                elif is_gas:
                    item.vat_rate = 0.0
                else:
                    item.vat_rate = 16.0

            item.total_cost = flt(item.quantity) * flt(item.unit_cost)
            vat_rate = flt(getattr(item, "vat_rate", 0))
            
            if getattr(item, "vat_inclusive", False):
                item.net_total = item.total_cost / (1 + (vat_rate / 100)) if vat_rate > 0 else item.total_cost
                item_vat = item.total_cost - item.net_total
                item_grand = item.total_cost
            else:
                item.net_total = item.total_cost
                item_vat = item.total_cost * (vat_rate / 100)
                item_grand = item.total_cost + item_vat
                
            net_total += item.net_total
            total_vat += item_vat
            grand_total += item_grand
            
        # Transport charge
        trans_charge = flt(self.transport_charge)
        if trans_charge > 0:
            trans_vat_rate = flt(getattr(self, "transport_vat_rate", 0))
            if getattr(self, "transport_vat_inclusive", False):
                trans_net = trans_charge / (1 + (trans_vat_rate / 100)) if trans_vat_rate > 0 else trans_charge
                trans_vat = trans_charge - trans_net
                trans_grand = trans_charge
            else:
                trans_net = trans_charge
                trans_vat = trans_charge * (trans_vat_rate / 100)
                trans_grand = trans_charge + trans_vat
            net_total += trans_net
            total_vat += trans_vat
            grand_total += trans_grand

        self.net_total = net_total
        self.total_vat = total_vat
        self.grand_total = grand_total

    def after_insert(self):
        self.create_purchase_invoice()

    def create_purchase_invoice(self):
        from frappe.utils import flt
        pi = frappe.new_doc("Purchase Invoice")
        pi.supplier = self.supplier
        pi.posting_date = self.document_date or self.receiving_date or frappe.utils.nowdate()
        pi.posting_time = frappe.utils.nowtime()
        pi.set_posting_time = 1
        pi.update_stock = 1
        pi.bill_no = self.document_invoice_number
        pi.custom_kra_invoice_number = self.tax_invoice_number
        
        company = frappe.defaults.get_user_default("Company")
        if company:
            pi.company = company
            
        total_vat_amount = 0.0

        for item in self.items:
            expense_account = frappe.db.get_value("Item Default", {"parent": item.item, "company": company}, "expense_account")
            if not expense_account:
                expense_account = frappe.get_cached_value("Company", company, "default_expense_account") or "Cost of Goods Sold"

            vat_rate = flt(getattr(item, "vat_rate", 0))
            if getattr(item, "vat_inclusive", False):
                unit_rate = flt(item.unit_cost) / (1 + (vat_rate / 100)) if vat_rate > 0 else flt(item.unit_cost)
                line_vat = (flt(item.quantity) * flt(item.unit_cost)) - (flt(item.quantity) * unit_rate)
            else:
                unit_rate = flt(item.unit_cost)
                line_vat = (flt(item.quantity) * unit_rate) * (vat_rate / 100)

            total_vat_amount += line_vat

            pi_item = {
                "item_code": item.item,
                "qty": item.quantity,
                "rate": unit_rate,
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
            
        if self.transport_charge and flt(self.transport_charge) > 0:
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
                        
            expense_account = frappe.db.get_value("Item Default", {"parent": item_code, "company": company}, "expense_account")
            if not expense_account:
                expense_account = frappe.get_cached_value("Company", company, "default_expense_account") or "Cost of Goods Sold"

            trans_vat_rate = flt(getattr(self, "transport_vat_rate", 0))
            trans_charge = flt(self.transport_charge)
            if getattr(self, "transport_vat_inclusive", False):
                trans_rate = trans_charge / (1 + (trans_vat_rate / 100)) if trans_vat_rate > 0 else trans_charge
                trans_vat = trans_charge - trans_rate
            else:
                trans_rate = trans_charge
                trans_vat = trans_charge * (trans_vat_rate / 100)
                
            total_vat_amount += trans_vat

            pi.append("items", {
                "item_code": item_code,
                "warehouse": self.items[0].target_location if self.items else None,
                "item_name": "Transport Charge",
                "description": "Transport Charge",
                "qty": 1,
                "rate": trans_rate,
                "expense_account": expense_account
            })
        
        # Attach VAT / Taxes to credit Supplier for full gross amount and debit VAT Control Account
        if total_vat_amount > 0:
            vat_account = frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%VAT Control%"], "is_group": 0}, "name")
            if not vat_account:
                vat_account = frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%VAT%"], "is_group": 0}, "name")
            if not vat_account:
                vat_account = "VAT Control - KIL"

            pi.append("taxes", {
                "charge_type": "Actual",
                "account_head": vat_account,
                "description": "VAT (Input Tax)",
                "tax_amount": total_vat_amount,
                "add_deduct_tax": "Add",
                "category": "Total"
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
def get_purchases_history(date_from=None, date_to=None, limit=None):
    filters = {}
    if date_from and date_to:
        filters['receiving_date'] = ['between', [date_from, date_to]]
    elif date_from:
        filters['receiving_date'] = ['>=', date_from]
    elif date_to:
        filters['receiving_date'] = ['<=', date_to]
    
    limit_num = int(limit) if limit else (1000 if (date_from or date_to) else 20)
    
    purchases = frappe.get_all('Station Purchase', filters=filters, fields=['name', 'receiving_date', 'supplier', 'tax_invoice_number', 'document_invoice_number', 'grand_total'], order_by='receiving_date desc, name desc', limit_page_length=limit_num)
    
    for p in purchases:
        p.items = frappe.get_all('Station Purchase Item', filters={'parent': p.name}, fields=['item', 'quantity'])
    
    return purchases



@frappe.whitelist()
def delete_purchase(purchase_name):
    # Check permissions
    if not (frappe.has_permission("Station Purchase", "delete") or frappe.session.user == "Administrator"):
        frappe.throw("Not permitted to delete purchases.")
        
    doc = frappe.get_doc("Station Purchase", purchase_name)
    
    # Try to find associated Purchase Invoice
    pi = frappe.get_all("Purchase Invoice", filters={"supplier": doc.supplier, "bill_no": doc.document_invoice_number}, order_by="creation desc", limit=1)
    
    if pi:
        pi_doc = frappe.get_doc("Purchase Invoice", pi[0].name)
        if pi_doc.docstatus == 1:
            try:
                pi_doc.cancel()
            except Exception as e:
                frappe.throw(f"Could not cancel associated Purchase Invoice {pi[0].name}. It may have linked Payment Entries. Please cancel them first.<br><br>Error: {str(e)}")
        try:
            frappe.delete_doc("Purchase Invoice", pi[0].name)
        except Exception:
            pass # It's okay if we can't delete it due to linked cancelled GL entries
        
    # Revert tank volumes
    for item in doc.items:
        if getattr(item, "target_tank", None):
            try:
                tank = frappe.get_doc("Fuel Tank", item.target_tank)
                if tank.current_volume is not None:
                    tank.current_volume -= item.quantity
                    tank.flags.ignore_permissions = True
                    tank.save()
            except Exception:
                pass
                
    # Finally delete the station purchase
    frappe.delete_doc("Station Purchase", purchase_name)
    return True

@frappe.whitelist()
def get_purchase_details(purchase_name):
    doc = frappe.get_doc("Station Purchase", purchase_name)
    return doc.as_dict()

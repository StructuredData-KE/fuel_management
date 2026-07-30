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
            pi_item = {
                "item_code": item.item,
                "qty": item.quantity,
                "rate": item.unit_cost,
                "warehouse": item.target_location,
                "received_qty": item.quantity,
                "expense_account": frappe.get_cached_value("Company", frappe.defaults.get_user_default("Company"), "default_expense_account") or "Cost of Goods Sold"
            }
            if getattr(item, "uom", None):
                pi_item["uom"] = item.uom
                
            pi.append("items", pi_item)
            
        if self.transport_charge and self.transport_charge > 0:
            pi.append("items", {
                "item_name": "Transport Charge",
                "description": "Transport Charge",
                "qty": 1,
                "rate": self.transport_charge,
                "expense_account": frappe.get_cached_value("Company", frappe.defaults.get_user_default("Company"), "default_expense_account") or "Cost of Goods Sold"
            })
        
        pi.flags.ignore_permissions = True
        pi.insert()
        pi.submit()
        
        # Suppress auto-generated warning messages about Expense Head changing
        if hasattr(frappe, "message_log"):
            frappe.message_log = []
        
        frappe.msgprint(f"Generated Purchase Invoice {pi.name}")

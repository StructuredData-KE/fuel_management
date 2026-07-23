# -*- coding: utf-8 -*-
import frappe
from frappe.model.document import Document

class StationPurchase(Document):
    def validate(self):
        self.total_cost = self.quantity * self.unit_cost
        if self.vat_inclusive:
            self.net_total = self.total_cost / 1.16  # Assuming 16% VAT standard in KE
        else:
            self.net_total = self.total_cost

    def after_insert(self):
        self.create_purchase_invoice()

    def create_purchase_invoice(self):
        pi = frappe.new_doc("Purchase Invoice")
        pi.supplier = self.supplier
        pi.posting_date = self.document_date or self.receiving_date or frappe.utils.nowdate()
        pi.posting_time = frappe.utils.nowtime()
        pi.set_posting_time = 1
        pi.update_stock = 1 # CRITICAL: Update physical inventory tanks/stores
        
        # We assume target_location is a Warehouse
        pi.append("items", {
            "item_code": self.item,
            "qty": self.quantity,
            "rate": self.unit_cost,
            "warehouse": self.target_location,
            "received_qty": self.quantity,
            "expense_account": frappe.get_cached_value("Company", frappe.defaults.get_user_default("Company"), "default_expense_account") or "Cost of Goods Sold"
        })
        
        pi.flags.ignore_permissions = True
        pi.insert()
        pi.submit()
        
        frappe.msgprint(f"Generated Purchase Invoice {pi.name} for {self.item}")

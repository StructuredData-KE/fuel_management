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
        self.create_purchase_receipt()

    def create_purchase_receipt(self):
        pr = frappe.new_doc("Purchase Receipt")
        pr.supplier = self.supplier
        pr.posting_date = self.document_date or self.receiving_date or frappe.utils.nowdate()
        pr.set_posting_time = 1
        
        # We assume target_location is a Warehouse
        pr.append("items", {
            "item_code": self.item,
            "qty": self.quantity,
            "rate": self.unit_cost,
            "warehouse": self.target_location,
            "received_qty": self.quantity
        })
        
        pr.flags.ignore_permissions = True
        pr.insert()
        pr.submit()
        
        frappe.msgprint(f"Generated Purchase Receipt {pr.name} for {self.item}")

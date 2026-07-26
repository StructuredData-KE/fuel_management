# -*- coding: utf-8 -*-
import frappe
from frappe.model.document import Document

class StationCards(Document):
    def validate(self):
        if self.receipt_no:
            exists = frappe.db.exists(
                "Station Cards", 
                {
                    "receipt_no": self.receipt_no,
                    "name": ["!=", self.name]
                }
            )
            if exists:
                frappe.throw(f"Receipt number {self.receipt_no} has already been saved.")

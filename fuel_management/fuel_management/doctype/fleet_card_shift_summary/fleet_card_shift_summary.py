# Copyright (c) 2026, USER and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

class FleetCardShiftSummary(Document):
    def validate(self):
        self.fetch_card_details()
        self.calculate_totals()
        
    def fetch_card_details(self):
        if self.fleet_card:
            card_doc = frappe.get_doc("Fleet Card", self.fleet_card)
            if self.is_new() or not self.opening_balance:
                self.opening_balance = flt(card_doc.opening_balance)
            self.discounted_price = flt(card_doc.discounted_price)
            
            # Fetch real fuel price based on Shift Date
            if self.shift and card_doc.linked_fuel_product:
                shift_date = frappe.db.get_value("Shift", self.shift, "date")
                price_record = frappe.get_all("Item Price", 
                    filters={"item_code": card_doc.linked_fuel_product, "price_list": "Standard Selling", "valid_from": ("<=", shift_date)},
                    fields=["price_list_rate"],
                    order_by="valid_from desc",
                    limit=1
                )
                self.real_fuel_price = price_record[0].price_list_rate if price_record else 0.0
                
    def calculate_totals(self):
        self.amount_used = flt(self.opening_balance) - flt(self.closing_balance) + flt(self.top_ups)
        
        if flt(self.discounted_price) > 0:
            self.liters_sold = flt(self.amount_used) / flt(self.discounted_price)
        else:
            self.liters_sold = 0.0
            
        total_cash = 0.0
        total_mpesa = 0.0
        total_invoices = 0.0
        
        for row in (self.csa_drops or []):
            total_cash += flt(row.cash_drop)
            total_mpesa += flt(row.mpesa_drop)
            total_invoices += flt(row.invoice_drop)
            
        self.total_csa_drops = total_cash
        self.expected_cash = (flt(self.liters_sold) * flt(self.real_fuel_price)) - total_mpesa - total_invoices
        self.variance = flt(self.total_csa_drops) - flt(self.expected_cash)
        
    def on_submit(self):
        # Update Fleet Card opening balance for next shift
        frappe.db.set_value("Fleet Card", self.fleet_card, "opening_balance", self.closing_balance)

import frappe
from frappe.model.document import Document
from frappe import _

class ShiftCashReconciliation(Document):
    def before_save(self):
        self.total_liabilities = (
            flt(self.meter_sales) + 
            flt(self.inventory_sales) + 
            flt(self.greasing_sales) + 
            flt(self.customer_payments)
        )
        
        self.total_deductions = (
            flt(self.mpesa) + 
            flt(self.invoices) + 
            flt(self.cards) + 
            flt(self.expenses) + 
            flt(self.rtt_deductions)
        )
        
        self.expected_cash = self.total_liabilities - self.total_deductions
        self.variance = flt(self.actual_cash) - self.expected_cash
        
    def validate(self):
        self.validate_shift_status()
        
    def on_trash(self):
        self.validate_shift_status()
        
    def validate_shift_status(self):
        if self.shift:
            shift_status = frappe.db.get_value("Shift", self.shift, "status")
            if shift_status in ["Ended", "Closed"]:
                frappe.throw(_("Cannot modify or delete reconciliation records for a closed shift."))

def flt(val):
    try:
        return float(val) if val else 0.0
    except ValueError:
        return 0.0

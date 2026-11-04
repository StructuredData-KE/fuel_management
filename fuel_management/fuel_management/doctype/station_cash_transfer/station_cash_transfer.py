import frappe
from frappe.model.document import Document
from frappe.utils import flt

class StationCashTransfer(Document):
    def after_insert(self):
        self.create_journal_entry()

    def on_update(self):
        if not self.is_new():
            old_doc = self.get_doc_before_save()
            if old_doc:
                if (old_doc.date != self.date or 
                    old_doc.transaction_number != self.transaction_number or 
                    old_doc.destination_account != self.destination_account or 
                    flt(old_doc.amount) != flt(self.amount)):
                    self.cancel_journal_entries()
                    self.create_journal_entry()

    def on_trash(self):
        self.cancel_journal_entries()

    def cancel_journal_entries(self):
        """Cancel any submitted Journal Entry associated with this transfer."""
        try:
            jes = frappe.get_all(
                "Journal Entry",
                filters=[
                    ["user_remark", "like", f"%{self.name}%"],
                    ["docstatus", "=", 1]
                ],
                pluck="name"
            )
            for je_name in jes:
                je = frappe.get_doc("Journal Entry", je_name)
                je.cancel()
        except Exception as e:
            frappe.log_error(f"Failed to cancel Journal Entry for Cash Transfer {self.name}: {str(e)}", "Station Cash Transfer Error")

    def create_journal_entry(self):
        """Generate a standard ERPNext Journal Entry for this cash transfer."""
        try:
            company = frappe.defaults.get_user_default("Company")
            if not company:
                companies = frappe.get_all("Company")
                company = companies[0].name if companies else None
                
            if not company:
                frappe.throw("No Company found in the system.")
                
            station_cash_account = frappe.db.get_value("Company", company, "default_cash_account")
            if not station_cash_account:
                cash_accounts = frappe.get_all("Account", filters={"account_type": "Cash", "company": company})
                if cash_accounts:
                    station_cash_account = cash_accounts[0].name
                else:
                    frappe.throw("No default cash account found to debit/credit.")
                
            je = frappe.get_doc({
                "doctype": "Journal Entry",
                "voucher_type": "Journal Entry",
                "posting_date": self.date,
                "company": company,
                "user_remark": f"External Cash Transfer: {self.transaction_number} - {self.name}",
                "accounts": [
                    {
                        "account": self.destination_account,
                        "debit_in_account_currency": flt(self.amount),
                        "credit_in_account_currency": 0
                    },
                    {
                        "account": station_cash_account,
                        "debit_in_account_currency": 0,
                        "credit_in_account_currency": flt(self.amount)
                    }
                ]
            })
            je.insert(ignore_permissions=True)
            je.submit()
        except Exception as e:
            frappe.log_error(f"Failed to create Journal Entry for Cash Transfer {self.name}: {str(e)}", "Station Cash Transfer Error")


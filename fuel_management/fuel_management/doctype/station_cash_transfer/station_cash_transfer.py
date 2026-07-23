import frappe
from frappe.model.document import Document

class StationCashTransfer(Document):
    def after_insert(self):
        """
        Generate a standard ERPNext Journal Entry when a Station Cash Transfer is submitted.
        Debits the destination account, Credits the default station cash account.
        """
        try:
            # Try to fetch company default cash account
            company = frappe.defaults.get_user_default("Company")
            if not company:
                companies = frappe.get_all("Company")
                company = companies[0].name if companies else None
                
            if not company:
                frappe.throw("No Company found in the system.")
                
            station_cash_account = frappe.db.get_value("Company", company, "default_cash_account")
            if not station_cash_account:
                # Fallback to first Cash account
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
                        "debit_in_account_currency": self.amount,
                        "credit_in_account_currency": 0
                    },
                    {
                        "account": station_cash_account,
                        "debit_in_account_currency": 0,
                        "credit_in_account_currency": self.amount
                    }
                ]
            })
            je.insert()
            je.submit()
            
            frappe.msgprint(f"Created Journal Entry {je.name} for Cash Transfer {self.name}")
        except Exception as e:
            frappe.log_error(f"Failed to create Journal Entry for Cash Transfer {self.name}: {str(e)}", "Station Cash Transfer Error")
            # Don't throw so it still saves the record, but log it

# -*- coding: utf-8 -*-
import frappe
from frappe.model.document import Document

class CustomerPayment(Document):
    def on_update(self):
        self.create_or_update_journal_entry()

    def on_trash(self):
        self.delete_journal_entry()

    def create_or_update_journal_entry(self):
        from frappe.utils import flt
        
        # Prevent posting zero or negative payments
        if flt(self.amount) <= 0:
            return

        # Cancel and delete any existing Journal Entry for this payment reference
        self.delete_journal_entry()

        company = frappe.defaults.get_user_default("Company")
        if not company:
            # Fallback to first company in the system if default not set
            companies = frappe.get_all("Company")
            if companies:
                company = companies[0].name
            else:
                frappe.throw("No Company found in the system.")

        # 1. Determine Debit Account
        debit_account = None
        if self.mode_of_payment == "Cash" and self.shift:
            # Try to get the shift control account from the Fuel Station of the shift
            station = frappe.db.get_value("Shift", self.shift, "station")
            if station:
                debit_account = frappe.db.get_value("Fuel Station", station, "shift_control_account")
        
        if not debit_account:
            # Get default account mapped to the Mode of Payment
            debit_account = frappe.db.get_value("Mode of Payment Account", {"parent": self.mode_of_payment, "company": company}, "default_account")

        if not debit_account:
            frappe.throw(f"Accounting Configuration Error: No Default Account found for Mode of Payment '{self.mode_of_payment}' for Company '{company}'.")

        # 2. Determine Credit Account (Customer AR)
        credit_account = frappe.db.get_value("Party Account", {"parent": self.customer, "parenttype": "Customer", "company": company}, "account")
        if not credit_account:
            credit_account = frappe.db.get_value("Company", company, "default_receivable_account")

        if not credit_account:
            frappe.throw(f"Accounting Configuration Error: No Accounts Receivable account found for Customer '{self.customer}'.")

        # 3. Create and submit standard ERPNext Journal Entry
        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.posting_date = self.date or frappe.utils.nowdate()
        je.company = company
        je.user_remark = f"Customer Payment Reference: {self.name}"
        
        je.append("accounts", {
            "account": debit_account,
            "debit_in_account_currency": self.amount,
            "user_remark": f"Customer Payment via {self.mode_of_payment} (Ref: {self.trans_no or ''})"
        })
        je.append("accounts", {
            "account": credit_account,
            "party_type": "Customer",
            "party": self.customer,
            "credit_in_account_currency": self.amount,
            "user_remark": f"Customer Payment collected by {self.csa or 'System'}"
        })
        
        je.flags.ignore_permissions = True
        je.insert()
        je.submit()

    def delete_journal_entry(self):
        # Find active linked Journal Entries
        existing_jes = frappe.get_all(
            "Journal Entry", 
            filters={"user_remark": f"Customer Payment Reference: {self.name}", "docstatus": ["<", 2]},
            fields=["name", "docstatus"]
        )
        for je in existing_jes:
            je_doc = frappe.get_doc("Journal Entry", je.name)
            if je.docstatus == 1:
                je_doc.flags.ignore_permissions = True
                je_doc.cancel()
            frappe.delete_doc("Journal Entry", je.name, ignore_permissions=True)


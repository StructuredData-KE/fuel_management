# Copyright (c) 2026, USER and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class StationPettyCashEntry(Document):
	def after_insert(self):
		if self.petty_cash_account and self.amount:
			account = frappe.get_doc("Station Petty Cash Account", self.petty_cash_account)
			account.current_balance = (account.current_balance or 0) - self.amount
			account.save(ignore_permissions=True)
			frappe.db.commit()

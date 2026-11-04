import frappe
from frappe.model.document import Document
from frappe.utils import flt

class StationPettyCashEntry(Document):
	def before_save(self):
		if not self.is_new():
			old_doc = self.get_doc_before_save()
			if old_doc:
				old_acc_name = old_doc.petty_cash_account
				old_amt = flt(old_doc.amount)
				new_acc_name = self.petty_cash_account
				new_amt = flt(self.amount)

				if old_acc_name == new_acc_name:
					diff = new_amt - old_amt
					if diff != 0 and new_acc_name:
						acc = frappe.get_doc("Station Petty Cash Account", new_acc_name)
						acc.current_balance = (acc.current_balance or 0) - diff
						acc.save(ignore_permissions=True)
				else:
					if old_acc_name and old_amt:
						old_acc = frappe.get_doc("Station Petty Cash Account", old_acc_name)
						old_acc.current_balance = (old_acc.current_balance or 0) + old_amt
						old_acc.save(ignore_permissions=True)
					if new_acc_name and new_amt:
						new_acc = frappe.get_doc("Station Petty Cash Account", new_acc_name)
						new_acc.current_balance = (new_acc.current_balance or 0) - new_amt
						new_acc.save(ignore_permissions=True)

	def after_insert(self):
		if self.petty_cash_account and self.amount:
			account = frappe.get_doc("Station Petty Cash Account", self.petty_cash_account)
			account.current_balance = (account.current_balance or 0) - flt(self.amount)
			account.save(ignore_permissions=True)
			frappe.db.commit()

	def on_trash(self):
		if self.petty_cash_account and self.amount:
			account = frappe.get_doc("Station Petty Cash Account", self.petty_cash_account)
			account.current_balance = (account.current_balance or 0) + flt(self.amount)
			account.save(ignore_permissions=True)
			frappe.db.commit()


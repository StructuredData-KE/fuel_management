import frappe
def execute():
    frappe.delete_doc("Shift", "SHIFT-26-07-21-0003", ignore_permissions=True, force=1)
    print("Deleted SHIFT-26-07-21-0003")



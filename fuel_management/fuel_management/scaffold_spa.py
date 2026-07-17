import frappe
from frappe.modules.export_file import export_to_files

def execute():
    page_name = "shift_operation_spa"
    if not frappe.db.exists("Page", page_name):
        doc = frappe.new_doc("Page")
        doc.page_name = page_name
        doc.title = "Shift Operations Console"
        doc.module = "Fuel Management"
        doc.standard = "Yes"
        doc.roles = [{"role": "System Manager"}]
        doc.insert(ignore_permissions=True)
        export_to_files(record_list=[['Page', page_name]], record_module="Fuel Management")
        print(f"Created Page {page_name}")

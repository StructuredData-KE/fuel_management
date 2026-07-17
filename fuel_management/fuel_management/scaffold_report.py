import frappe
from frappe.modules.export_file import export_to_files

def execute():
    frappe.flags.in_import = True
    report_name = "Monthly Volume Report"
    if not frappe.db.exists("Report", report_name):
        doc = frappe.new_doc("Report")
        doc.report_name = report_name
        doc.ref_doctype = "Fuel Tank"
        doc.report_type = "Script Report"
        doc.is_standard = "Yes"
        doc.module = "Fuel Management"
        doc.insert(ignore_permissions=True)
        export_to_files(record_list=[['Report', report_name]], record_module="Fuel Management")
        print("Created Monthly Volume Report")

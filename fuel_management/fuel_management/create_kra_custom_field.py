import frappe

def create_custom_field():
    if not frappe.db.exists("Custom Field", "Purchase Invoice-custom_kra_invoice_number"):
        doc = frappe.get_doc({
            "doctype": "Custom Field",
            "dt": "Purchase Invoice",
            "fieldname": "custom_kra_invoice_number",
            "fieldtype": "Data",
            "label": "KRA Invoice Number",
            "insert_after": "bill_date"
        })
        doc.insert(ignore_permissions=True)
        print("Created Custom Field: custom_kra_invoice_number on Purchase Invoice")
    else:
        print("Custom Field already exists.")

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

def create_reconciliation_doctype():
    name = "Shift Cash Reconciliation"
    if frappe.db.exists("DocType", name):
        print(f"DocType {name} already exists. Skipping.")
        return
        
    doc = frappe.new_doc("DocType")
    doc.name = name
    doc.module = "Fuel Management"
    doc.custom = 0
    doc.istable = 0
    doc.naming_rule = "Expression"
    doc.autoname = "format:REC-{shift}-{csa}-{####}"
    doc.is_submittable = 0
    doc.track_changes = 1
    
    fields = [
        {"fieldname": "shift", "label": "Shift", "fieldtype": "Link", "options": "Shift", "reqd": 1, "in_list_view": 1},
        {"fieldname": "csa", "label": "CSA", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
        {"fieldname": "manager", "label": "Manager", "fieldtype": "Link", "options": "User", "reqd": 1},
        {"fieldname": "timestamp", "label": "Timestamp", "fieldtype": "Datetime", "reqd": 1},
        
        {"fieldname": "cb_1", "fieldtype": "Column Break"},
        {"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Draft\nSaved", "default": "Saved", "read_only": 1},
        
        {"fieldname": "sb_liabilities", "label": "Sales / Liabilities", "fieldtype": "Section Break"},
        {"fieldname": "meter_sales", "label": "Meter Sales", "fieldtype": "Currency", "default": 0},
        {"fieldname": "inventory_sales", "label": "Inventory Sales", "fieldtype": "Currency", "default": 0},
        {"fieldname": "greasing_sales", "label": "Greasing Sales", "fieldtype": "Currency", "default": 0},
        {"fieldname": "customer_payments", "label": "Customer Payments", "fieldtype": "Currency", "default": 0},
        {"fieldname": "total_liabilities", "label": "Total Liabilities", "fieldtype": "Currency", "read_only": 1, "bold": 1},
        
        {"fieldname": "sb_deductions", "label": "Deductions", "fieldtype": "Section Break"},
        {"fieldname": "mpesa", "label": "M-Pesa", "fieldtype": "Currency", "default": 0},
        {"fieldname": "invoices", "label": "Invoices", "fieldtype": "Currency", "default": 0},
        {"fieldname": "cards", "label": "Cards", "fieldtype": "Currency", "default": 0},
        {"fieldname": "expenses", "label": "Expenses", "fieldtype": "Currency", "default": 0},
        {"fieldname": "rtt_deductions", "label": "RTT Deductions", "fieldtype": "Currency", "default": 0},
        {"fieldname": "total_deductions", "label": "Total Deductions", "fieldtype": "Currency", "read_only": 1, "bold": 1},
        
        {"fieldname": "sb_reconciliation", "label": "Reconciliation", "fieldtype": "Section Break"},
        {"fieldname": "expected_cash", "label": "Expected Cash", "fieldtype": "Currency", "read_only": 1, "bold": 1, "in_list_view": 1},
        {"fieldname": "cb_2", "fieldtype": "Column Break"},
        {"fieldname": "actual_cash", "label": "Actual Cash Submitted", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
        {"fieldname": "cb_3", "fieldtype": "Column Break"},
        {"fieldname": "variance", "label": "Variance", "fieldtype": "Currency", "read_only": 1, "bold": 1, "in_list_view": 1}
    ]
    
    for f in fields:
        doc.append("fields", f)
        
    doc.insert(ignore_permissions=True)
    
    # Permissions
    perm = frappe.new_doc("Custom DocPerm")
    perm.parent = doc.name
    perm.parenttype = "DocType"
    perm.parentfield = "permissions"
    perm.role = "System Manager"
    perm.read = 1
    perm.write = 1
    perm.create = 1
    perm.delete = 1
    perm.insert(ignore_permissions=True)
    
    print(f"Created {name}")

def execute():
    try:
        create_reconciliation_doctype()
        frappe.db.commit()
        print("Successfully created Shift Cash Reconciliation Doctype")
    except Exception as e:
        frappe.db.rollback()
        print(f"Error creating doctype: {e}")

if __name__ == "__main__":
    execute()

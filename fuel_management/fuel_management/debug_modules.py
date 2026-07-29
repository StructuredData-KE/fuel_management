import frappe
def execute():
    try:
        print("Module app cache keys:", list(frappe.local.module_app.keys()) if hasattr(frappe.local, 'module_app') else 'Not initialized')
    except Exception as e:
        print(e)

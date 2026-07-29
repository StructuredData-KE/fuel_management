import frappe
def execute():
    try:
        frappe.init(site="kilibetcore.co.ke")
        frappe.connect()
        frappe.local.request = True 
        import frappe.app
        frappe.app.make_form_dict(frappe.request)
        print("Module app cache keys:", list(frappe.local.module_app.keys()) if hasattr(frappe.local, 'module_app') else 'Not initialized')
        print("Fuel Management in cache?", 'fuel_management' in frappe.local.module_app)
    except Exception as e:
        print(e)

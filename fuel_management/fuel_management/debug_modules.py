import frappe
def execute():
    try:
        print("Installed apps:", frappe.get_installed_apps())
        print("Module list for fuel_management:", frappe.get_module_list("fuel_management"))
        print("Module app cache:", frappe.local.module_app.get("fuel_management"))
    except Exception as e:
        print(e)

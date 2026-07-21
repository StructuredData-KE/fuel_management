import frappe
def execute():
    station = "RUBIS POA PLACE"
    pump_groups = frappe.get_all("Pump Group", filters={"station": station}, pluck="name")
    print(f"PUMP GROUPS: {pump_groups}")
    nozzles = frappe.get_all("Pump Nozzle", filters={"pump_group": ["in", pump_groups]}, fields=["name"]) if pump_groups else []
    print(f"NOZZLES: {nozzles}")


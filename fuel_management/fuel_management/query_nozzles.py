import frappe

def execute():
    nozzles = frappe.get_all("Pump Nozzle", fields=["name", "pump_group"])
    print("ALL NOZZLES IN DB:")
    for n in nozzles:
        print(f" - {n.name} (Group: {n.pump_group})")
        
    pgs = frappe.get_all("Pump Group", fields=["name", "station"])
    print("\nALL PUMP GROUPS:")
    for p in pgs:
        print(f" - {p.name} (Station: {p.station})")

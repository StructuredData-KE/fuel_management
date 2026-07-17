import frappe
from frappe.modules.export_file import export_to_files

def create_doctype(name, module, fields, is_submittable=0, istable=0, naming_rule="Expression", autoname=None, permissions=None):
    if not frappe.db.exists("DocType", name):
        doc = frappe.new_doc("DocType")
        doc.name = name
        doc.module = module
        doc.custom = 0
        doc.is_submittable = is_submittable
        doc.istable = istable
        if naming_rule: doc.naming_rule = naming_rule
        if autoname: doc.autoname = autoname
        
        for f in fields:
            doc.append("fields", f)
            
        if permissions:
            for p in permissions:
                doc.append("permissions", p)
        elif not istable:
            doc.append("permissions", {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1})
            doc.append("permissions", {"role": "Fleet Manager", "read": 1, "write": 1, "create": 1, "delete": 1}) # Example
            
        try:
            doc.insert(ignore_permissions=True)
            print(f"Created {name}")
            export_to_files(record_list=[['DocType', name]], record_module=module)
        except Exception as e:
            print(f"Failed {name}: {str(e)}")

def execute():
    # 1. Shift Assigned CSA
    create_doctype("Shift Assigned CSA", "Fuel Management", [
        {"fieldname": "csa", "label": "CSA", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1},
        {"fieldname": "pump_group", "label": "Pump Group", "fieldtype": "Link", "options": "Pump Group", "in_list_view": 1}
    ], istable=1, naming_rule=None)

    # 2. Station Opening Nozzle (Child of Opening Balance)
    create_doctype("Station Opening Nozzle", "Fuel Management", [
        {"fieldname": "pump_nozzle", "label": "Pump Nozzle", "fieldtype": "Link", "options": "Pump Nozzle", "in_list_view": 1, "reqd": 1},
        {"fieldname": "opening_electronic_meter", "label": "Opening Electronic", "fieldtype": "Float", "in_list_view": 1, "reqd": 1},
        {"fieldname": "opening_manual_meter", "label": "Opening Manual", "fieldtype": "Float", "in_list_view": 1, "reqd": 1}
    ], istable=1, naming_rule=None)

    # 3. Station Opening M-Pesa (Child)
    create_doctype("Station Opening M-Pesa", "Fuel Management", [
        {"fieldname": "account", "label": "Account", "fieldtype": "Link", "options": "Account", "in_list_view": 1, "reqd": 1},
        {"fieldname": "opening_balance", "label": "Opening Balance", "fieldtype": "Currency", "in_list_view": 1, "reqd": 1}
    ], istable=1, naming_rule=None)

    # 4. Station Opening Balance
    create_doctype("Station Opening Balance", "Fuel Management", [
        {"fieldname": "station", "label": "Station", "fieldtype": "Link", "options": "Fuel Station", "reqd": 1},
        {"fieldname": "date", "label": "Date", "fieldtype": "Date", "reqd": 1, "default": "Today"},
        {"fieldname": "sb_meters", "label": "Pump Meters", "fieldtype": "Section Break"},
        {"fieldname": "nozzle_balances", "label": "Nozzle Balances", "fieldtype": "Table", "options": "Station Opening Nozzle"},
        {"fieldname": "sb_mpesa", "label": "M-Pesa Tills", "fieldtype": "Section Break"},
        {"fieldname": "mpesa_balances", "label": "M-Pesa Balances", "fieldtype": "Table", "options": "Station Opening M-Pesa"}
    ], is_submittable=1, autoname="format:SOB-{station}-{YYYY}-{MM}-{DD}")

    # 5. Fleet Card CSA Drop (Child)
    create_doctype("Fleet Card CSA Drop", "Fuel Management", [
        {"fieldname": "csa", "label": "CSA", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1},
        {"fieldname": "cash_drop", "label": "Cash Drop", "fieldtype": "Currency", "in_list_view": 1},
        {"fieldname": "mpesa_drop", "label": "M-Pesa", "fieldtype": "Currency", "in_list_view": 1},
        {"fieldname": "invoice_drop", "label": "Invoices", "fieldtype": "Currency", "in_list_view": 1}
    ], istable=1, naming_rule=None)

    # 6. Fleet Card Shift Summary
    create_doctype("Fleet Card Shift Summary", "Fuel Management", [
        {"fieldname": "shift", "label": "Shift", "fieldtype": "Link", "options": "Shift", "reqd": 1, "in_list_view": 1},
        {"fieldname": "fleet_card", "label": "Fleet Card", "fieldtype": "Link", "options": "Fleet Card", "reqd": 1, "in_list_view": 1},
        {"fieldname": "sb_1", "fieldtype": "Section Break", "label": "Card Balances"},
        {"fieldname": "opening_balance", "label": "Opening Balance", "fieldtype": "Currency", "read_only": 1},
        {"fieldname": "top_ups", "label": "Top-Ups", "fieldtype": "Currency"},
        {"fieldname": "closing_balance", "label": "Closing Balance", "fieldtype": "Currency"},
        {"fieldname": "cb_1", "fieldtype": "Column Break"},
        {"fieldname": "amount_used", "label": "Total Amount Used", "fieldtype": "Currency", "read_only": 1},
        {"fieldname": "discounted_price", "label": "Discounted Price", "fieldtype": "Currency", "read_only": 1},
        {"fieldname": "liters_sold", "label": "Liters Sold", "fieldtype": "Float", "read_only": 1},
        {"fieldname": "sb_2", "fieldtype": "Section Break", "label": "CSA Cash Drops"},
        {"fieldname": "csa_drops", "label": "CSA Drops", "fieldtype": "Table", "options": "Fleet Card CSA Drop"},
        {"fieldname": "sb_3", "fieldtype": "Section Break", "label": "Variance"},
        {"fieldname": "real_fuel_price", "label": "Real Fuel Price", "fieldtype": "Currency", "read_only": 1},
        {"fieldname": "expected_cash", "label": "Expected Cash", "fieldtype": "Currency", "read_only": 1},
        {"fieldname": "total_csa_drops", "label": "Total Drops", "fieldtype": "Currency", "read_only": 1},
        {"fieldname": "variance", "label": "Variance", "fieldtype": "Currency", "read_only": 1}
    ], is_submittable=1, autoname="format:FCS-{fleet_card}-{YYYY}-{MM}-{DD}-{####}")

    # 7. Staff Liability Ledger
    create_doctype("Staff Liability Ledger", "Fuel Management", [
        {"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
        {"fieldname": "date", "label": "Date", "fieldtype": "Date", "reqd": 1, "default": "Today", "in_list_view": 1},
        {"fieldname": "shift", "label": "Shift Reference", "fieldtype": "Link", "options": "Shift", "in_list_view": 1},
        {"fieldname": "amount", "label": "Liability Amount", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
        {"fieldname": "reason", "label": "Reason", "fieldtype": "Small Text"},
        {"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Unpaid\nDeducted\nWaived", "default": "Unpaid", "in_list_view": 1}
    ], is_submittable=1, autoname="format:SLL-{employee}-{YYYY}-{####}")

    print("Phase 3 Scaffold Complete.")

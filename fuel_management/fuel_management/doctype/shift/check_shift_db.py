import frappe

def check_shifts():
    shifts = frappe.db.sql("SELECT name, status, start_time FROM tabShift ORDER BY modified DESC LIMIT 5;", as_dict=True)
    for s in shifts:
        print(s)

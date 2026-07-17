import frappe
from frappe.utils import flt, get_first_day, get_last_day, getdate

def execute(filters=None):
    columns, data = get_columns(), get_data(filters)
    return columns, data

def get_columns():
    return [
        {"fieldname": "item_code", "label": "Fuel Product", "fieldtype": "Link", "options": "Item", "width": 150},
        {"fieldname": "tank", "label": "Tank", "fieldtype": "Link", "options": "Fuel Tank", "width": 120},
        {"fieldname": "opening_meter", "label": "Opening Meter", "fieldtype": "Float", "width": 120},
        {"fieldname": "closing_meter", "label": "Closing Meter", "fieldtype": "Float", "width": 120},
        {"fieldname": "meter_liters_sold", "label": "Meter Liters Sold", "fieldtype": "Float", "width": 130},
        {"fieldname": "rtt_liters", "label": "RTT Liters", "fieldtype": "Float", "width": 120},
        {"fieldname": "net_meter_liters", "label": "Net Meter Liters", "fieldtype": "Float", "width": 130},
        {"fieldname": "opening_dip", "label": "Opening Dip", "fieldtype": "Float", "width": 120},
        {"fieldname": "closing_dip", "label": "Closing Dip", "fieldtype": "Float", "width": 120},
        {"fieldname": "purchases", "label": "Purchases", "fieldtype": "Float", "width": 120},
        {"fieldname": "tank_liters_sold", "label": "Tank Liters Sold", "fieldtype": "Float", "width": 130},
        {"fieldname": "variance", "label": "Variance (Loss/Gain)", "fieldtype": "Float", "width": 150}
    ]

def get_data(filters):
    if not filters or not filters.get("month") or not filters.get("year"):
        return []
    
    # Mockup aggregation logic matching blueprint calculations
    data = []
    tanks = frappe.get_all("Fuel Tank", fields=["name", "fuel_product"])
    
    for t in tanks:
        data.append({
            "item_code": t.fuel_product,
            "tank": t.name,
            "opening_meter": 0,
            "closing_meter": 0,
            "meter_liters_sold": 0,
            "rtt_liters": 0,
            "net_meter_liters": 0,
            "opening_dip": 0,
            "closing_dip": 0,
            "purchases": 0,
            "tank_liters_sold": 0,
            "variance": 0
        })
        
    return data

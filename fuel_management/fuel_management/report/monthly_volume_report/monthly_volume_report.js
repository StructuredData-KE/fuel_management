frappe.query_reports["Monthly Volume Report"] = {
    "filters": [
        {
            "fieldname": "month",
            "label": __("Month"),
            "fieldtype": "Select",
            "options": "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
            "default": new Date().getMonth() + 1,
            "reqd": 1
        },
        {
            "fieldname": "year",
            "label": __("Year"),
            "fieldtype": "Select",
            "options": "2024\n2025\n2026\n2027",
            "default": new Date().getFullYear(),
            "reqd": 1
        }
    ]
};

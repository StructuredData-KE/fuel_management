import frappe
from frappe.utils import flt

@frappe.whitelist()
def get_debtors_data():
    # 1. Get total invoiced per customer from Shift Invoices
    invoices = frappe.db.sql("""
        SELECT 
            si.customer, 
            SUM(si.amount) as total_invoiced
        FROM 
            `tabShift Invoice` si
        JOIN 
            `tabShift` s ON si.parent = s.name
        WHERE 
            s.docstatus < 2
        GROUP BY 
            si.customer
    """, as_dict=True)
    
    # 2. Get total paid per customer from Customer Payment
    payments = frappe.db.sql("""
        SELECT 
            customer, 
            SUM(amount) as total_paid, 
            MAX(date) as last_payment_date
        FROM 
            `tabCustomer Payment`
        WHERE 
            docstatus < 2
        GROUP BY 
            customer
    """, as_dict=True)
    
    customers = set()
    for inv in invoices:
        if inv.customer:
            customers.add(inv.customer)
    for pay in payments:
        if pay.customer:
            customers.add(pay.customer)
            
    if not customers:
        return []
        
    customers_data = frappe.db.get_all('Customer', 
        filters={'name': ['in', list(customers)]},
        fields=['name', 'customer_name']
    )
    customer_map = {c.name: c.customer_name for c in customers_data}
    
    payment_map = {p.customer: p for p in payments}
    invoice_map = {i.customer: i for i in invoices}
    
    results = []
    
    for cust in customers:
        inv = invoice_map.get(cust, {})
        pay = payment_map.get(cust, {})
        total_invoiced = flt(inv.get('total_invoiced', 0))
        total_paid = flt(pay.get('total_paid', 0))
        last_payment_date = pay.get('last_payment_date', None)
        balance = total_invoiced - total_paid

        # Get credit limit safely
        credit_limit = frappe.db.get_value("Customer", cust, "credit_limit")
        if not credit_limit:
            credit_limit = frappe.db.get_value("Customer Credit Limit", {"parent": cust}, "credit_limit") or 0.0
            
        credit_limit = flt(credit_limit)
        
        status = 'Safe'
        if credit_limit > 0:
            if balance >= credit_limit:
                status = 'Overdue'
            elif balance >= 0.8 * credit_limit:
                status = 'Near Limit'
        elif balance > 0:
            status = 'Near Limit'
            
        results.append({
            'id': cust,
            'name': customer_map.get(cust, cust),
            'fleet_id': cust, 
            'last_payment_date': str(last_payment_date) if last_payment_date else '',
            'total_invoiced': total_invoiced,
            'total_paid': total_paid,
            'balance': balance,
            'status': status,
            'credit_limit': credit_limit
        })
        
    results.sort(key=lambda x: x['balance'], reverse=True)
    
    return results

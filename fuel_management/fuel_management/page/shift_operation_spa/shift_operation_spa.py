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
    
    # 3. Get Opening Balances and Standard ERPNext GL Entries (excluding Shift Closure JEs)
    gl_balances = frappe.db.sql("""
        SELECT 
            party as customer,
            SUM(debit) as total_debit,
            SUM(credit) as total_credit
        FROM `tabGL Entry`
        WHERE party_type = 'Customer' AND is_cancelled = 0
        AND (remarks IS NULL OR (remarks NOT LIKE '%%Shift Closure Accounting%%' AND remarks NOT LIKE '%%Customer Payment Reference%%'))
        GROUP BY party
    """, as_dict=True)
    
    customers = set()
    for inv in invoices:
        if inv.customer:
            customers.add(inv.customer)
    for pay in payments:
        if pay.customer:
            customers.add(pay.customer)
    for gl in gl_balances:
        if gl.customer:
            customers.add(gl.customer)
            
    if not customers:
        return []
        
    customers_data = frappe.db.get_all('Customer', 
        filters={'name': ['in', list(customers)]},
        fields=['name', 'customer_name']
    )
    customer_map = {c.name: c.customer_name for c in customers_data}
    
    payment_map = {p.customer: p for p in payments}
    invoice_map = {i.customer: i for i in invoices}
    gl_map = {g.customer: flt(g.total_debit) - flt(g.total_credit) for g in gl_balances}
    
    results = []
    
    for cust in customers:
        inv = invoice_map.get(cust, {})
        pay = payment_map.get(cust, {})
        opening_balance = gl_map.get(cust, 0.0)
        
        total_invoiced = flt(inv.get('total_invoiced', 0))
        total_paid = flt(pay.get('total_paid', 0))
        last_payment_date = pay.get('last_payment_date', None)
        
        balance = opening_balance + total_invoiced - total_paid

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
            'opening_balance': opening_balance,
            'balance': balance,
            'status': status,
            'credit_limit': credit_limit
        })
        
    results.sort(key=lambda x: x['balance'], reverse=True)
    
    return results

@frappe.whitelist()
def get_customer_transactions(customer):
    transactions = []
    
    # 1. Get Opening Balances / Standard GL Entries (excluding Shift Closure JEs)
    gl_entries = frappe.db.sql("""
        SELECT 
            posting_date as date,
            voucher_type as ref_type,
            voucher_no as reference,
            remarks as description,
            debit,
            credit
        FROM `tabGL Entry`
        WHERE party_type = 'Customer' 
        AND party = %s 
        AND is_cancelled = 0
        AND (remarks IS NULL OR (remarks NOT LIKE '%%Shift Closure Accounting%%' AND remarks NOT LIKE '%%Customer Payment Reference%%'))
    """, customer, as_dict=True)
    
    for gle in gl_entries:
        transactions.append({
            'date': str(gle.date),
            'ref_type': gle.ref_type,
            'description': gle.description or gle.reference,
            'type': 'GL Entry',
            'debit': flt(gle.debit),
            'credit': flt(gle.credit)
        })
        
    # 2. Get Shift Invoices
    invoices = frappe.db.sql("""
        SELECT 
            s.shift_date as date,
            si.name as reference,
            'Shift Invoice' as ref_type,
            IFNULL(si.vehicle_registration, 'N/A') as description,
            si.amount as debit
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        WHERE si.customer = %s AND s.docstatus < 2
    """, customer, as_dict=True)
    
    for inv in invoices:
        transactions.append({
            'date': str(inv.date),
            'ref_type': inv.ref_type,
            'description': f"Vehicle: {inv.description}",
            'type': 'Invoice',
            'debit': flt(inv.debit),
            'credit': 0.0
        })
        
    # 3. Get Customer Payments
    payments = frappe.db.sql("""
        SELECT 
            date,
            name as reference,
            'Customer Payment' as ref_type,
            memo as description,
            amount as credit
        FROM `tabCustomer Payment`
        WHERE customer = %s AND docstatus < 2
    """, customer, as_dict=True)
    
    for pay in payments:
        transactions.append({
            'date': str(pay.date),
            'ref_type': pay.ref_type,
            'description': pay.description or 'Payment Received',
            'type': 'Payment',
            'debit': 0.0,
            'credit': flt(pay.credit)
        })
        
    # Sort chronologically
    transactions.sort(key=lambda x: x['date'])
    return transactions

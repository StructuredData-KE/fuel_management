import frappe
from frappe.utils import today, getdate, flt, formatdate, now_datetime
import json

@frappe.whitelist()
def get_dashboard_summary(from_date=None, to_date=None, station=None):
    """Returns a high-level summary of the dashboard metrics."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = to_date
    
    station_shift_clause = ""
    station_fs_clause = ""
    station_params = []
    if station and station not in ("ALL", "All Stations", ""):
        station_shift_clause = " AND station = %s"
        station_fs_clause = " AND fs.station = %s"
        station_params.append(station)

    # Financial Overview
    # 1. Total Sales Today (or selected period)
    total_sales_today = frappe.db.sql(f"""
        SELECT SUM(expected_cash + expected_dry_stock_cash) 
        FROM `tabShift` 
        WHERE docstatus < 2 AND DATE(shift_date) >= %s AND DATE(shift_date) <= %s {station_shift_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    # 2. Collections Split
    # We will sum M-Pesa payments
    mpesa_total = frappe.db.sql(f"""
        SELECT SUM(mp.amount) 
        FROM `tabShift M-Pesa Payment` mp 
        INNER JOIN `tabShift` fs ON mp.parent = fs.name 
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s {station_fs_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    card_total = frappe.db.sql(f"""
        SELECT SUM(cp.amount) 
        FROM `tabShift Card Payment` cp 
        INNER JOIN `tabShift` fs ON cp.parent = fs.name 
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s {station_fs_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    cash_total = frappe.db.sql(f"""
        SELECT SUM(actual_cash + actual_dry_stock_cash) 
        FROM `tabShift` 
        WHERE docstatus < 2 AND DATE(shift_date) >= %s AND DATE(shift_date) <= %s {station_shift_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    collections = {
        "mpesa": float(mpesa_total),
        "card": float(card_total),
        "cash": float(cash_total),
        "total": float(mpesa_total + card_total + cash_total)
    }

    # 3. Variance and Reconciliations
    shift_variance = frappe.db.sql(f"""
        SELECT SUM(st.variance)
        FROM `tabDip Stick Reading` st
        INNER JOIN `tabShift` fs ON st.parent = fs.name
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s {station_fs_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    # Inventory / Assets
    # Tank Levels from latest physical dip stick readings
    tank_data = get_tank_levels(station=station if (station and station not in ("ALL", "All Stations", "")) else None)
    tank_levels = tank_data.get("tanks", [])

    # Alerts
    alerts = []
    
    # High Variance Alert
    if abs(shift_variance) > 50:
        st_label = f" ({station})" if station and station not in ("ALL", "All Stations", "") else ""
        alerts.append({
            "title": f"High Fuel Variance{st_label}",
            "desc": f"Total station variance today is {shift_variance:.1f} Liters.",
            "type": "danger",
            "icon": "water_drop"
        })

    # Critical Low Tank Alert
    for t in tank_levels:
        if t.get("status") == "critical":
            alerts.append({
                "title": f"Low Fuel: {t.get('tank_name')}",
                "desc": f"{t.get('tank_name')} is critically low at {t.get('percentage')}% ({flt(t.get('last_dip_volume')):,.0f} L / {flt(t.get('capacity')):,.0f} L). Order replenishment.",
                "type": "danger",
                "icon": "warning"
            })

    # Holding Account Balance
    holding_cond = ""
    holding_args = []
    if station and station not in ("ALL", "All Stations", ""):
        holding_cond = " AND name = %s"
        holding_args.append(station)

    holding_accounts = frappe.db.sql(f"""
        SELECT DISTINCT top_up_holding_account 
        FROM `tabFuel Station` 
        WHERE top_up_holding_account IS NOT NULL AND top_up_holding_account != '' {holding_cond}
    """, holding_args, pluck=True)

    holding_balance = 0.0
    if holding_accounts:
        from erpnext.accounts.utils import get_balance_on
        for acc in holding_accounts:
            holding_balance += abs(flt(get_balance_on(acc)))
            
    if holding_balance > 0:
        alerts.append({
            "title": "Pending Supplier Top-ups",
            "desc": f"You have {frappe.format_value(holding_balance, 'Currency')} sitting in the Top-Up Holding Account pending reconciliation with Rubis.",
            "type": "warning",
            "icon": "payments"
        })

    # Pending Borrowed Products
    bp_station_clause = ""
    bp_params = []
    if station and station not in ("ALL", "All Stations", ""):
        bp_station_clause = " AND bp.station = %s"
        bp_params.append(station)
        
    pending_bp_records = frappe.db.sql(f"""
        SELECT 
            bp.name, bp.station, bp.date, bp.return_date, bp.counterparty, bp.type, bp.status, bp.memo
        FROM `tabBorrowed Product` bp
        WHERE bp.status = 'Pending Return' {bp_station_clause}
        ORDER BY bp.date DESC, bp.creation DESC
        LIMIT 100
    """, bp_params, as_dict=True)
    
    if pending_bp_records:
        names = [r.name for r in pending_bp_records]
        items = frappe.get_all("Borrowed Product Item",
            filters={"parent": ["in", names]},
            fields=["parent", "item_code", "qty"]
        )
        item_codes = list(set([i.item_code for i in items if i.item_code]))
        item_name_map = {}
        if item_codes:
            item_data = frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_name"])
            item_name_map = {d.name: (d.item_name or d.name) for d in item_data}

        items_map = {}
        for item in items:
            item["item_name"] = item_name_map.get(item.item_code, item.item_code)
            items_map.setdefault(item.parent, []).append(item)
        for r in pending_bp_records:
            r["items"] = items_map.get(r.name, [])
            
    if len(pending_bp_records) > 0:
        st_label = f" for {station}" if station and station not in ("ALL", "All Stations", "") else ""
        alerts.append({
            "title": f"Pending Borrowed Products{st_label} ({len(pending_bp_records)})",
            "desc": f"There are {len(pending_bp_records)} borrowed product transactions awaiting settlement or return.",
            "type": "warning",
            "icon": "sync_alt"
        })

    # M-Pesa Tills Live Balance Calculation
    mpesa_station_filter = ""
    mpesa_station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        mpesa_station_filter = " AND station = %s"
        mpesa_station_args.append(station)

    active_tills = frappe.db.sql(f"""
        SELECT name, till_name, till_number, station, default_account, bank_account
        FROM `tabM-Pesa Till`
        WHERE is_active = 1 {mpesa_station_filter}
        ORDER BY station ASC, till_name ASC
    """, mpesa_station_args, as_dict=True)

    tills_summary = []
    total_live_mpesa = 0.0
    mpesa_account_names = set()

    for t in active_tills:
        if t.default_account:
            mpesa_account_names.add(t.default_account)

        latest_reading = frappe.db.sql("""
            SELECT mp.closing_balance, mp.opening_balance, mp.amount, s.shift_date, s.status
            FROM `tabShift M-Pesa Payment` mp
            JOIN `tabShift` s ON s.name = mp.parent
            WHERE mp.mpesa_till = %s AND s.docstatus < 2
            ORDER BY s.shift_date DESC, s.creation DESC
            LIMIT 1
        """, (t.name,), as_dict=True)

        till_balance = 0.0
        last_date = None
        if latest_reading:
            r = latest_reading[0]
            last_date = r.shift_date
            if r.status == "Closed" or flt(r.closing_balance) > 0:
                till_balance = flt(r.closing_balance)
            else:
                till_balance = flt(r.opening_balance)
        
        total_live_mpesa += till_balance
        tills_summary.append({
            "till": t.name,
            "station": t.station,
            "balance": till_balance,
            "last_date": str(last_date) if last_date else "",
            "account": t.default_account or "",
            "bank_account": t.bank_account or ""
        })

    gl_mpesa_balance = 0.0
    if mpesa_account_names:
        from erpnext.accounts.utils import get_balance_on
        for acc in mpesa_account_names:
            gl_mpesa_balance += flt(get_balance_on(acc))

    mpesa_live_data = {
        "total_balance": total_live_mpesa,
        "gl_balance": gl_mpesa_balance,
        "tills_count": len(active_tills),
        "tills": tills_summary
    }

    # Return Payload
    return {
        "financials": {
            "total_sales_today": total_sales_today,
            "collections": collections,
            "top_up_holding_balance": holding_balance,
            "mpesa_live": mpesa_live_data
        },
        "reconciliations": {
            "fuel_variance_today": shift_variance
        },
        "inventory": {
            "tank_levels": tank_levels,
            "summary": tank_data.get("summary", {})
        },
        "pending_borrowed": {
            "count": len(pending_bp_records),
            "records": pending_bp_records
        },
        "alerts": alerts,
        "date": f"{formatdate(from_date)} to {formatdate(to_date)}",
        "station": station or "All Stations"
    }

@frappe.whitelist()
def get_pending_borrowed_summary(station=None):
    """Returns all pending borrowed product transactions, optionally filtered by station."""
    station_clause = ""
    params = []
    if station and station not in ("ALL", "All Stations", ""):
        station_clause = " AND bp.station = %s"
        params.append(station)
        
    records = frappe.db.sql(f"""
        SELECT 
            bp.name, bp.station, bp.date, bp.return_date, bp.counterparty, bp.type, bp.status, bp.memo
        FROM `tabBorrowed Product` bp
        WHERE bp.status = 'Pending Return' {station_clause}
        ORDER BY bp.date DESC, bp.creation DESC
        LIMIT 100
    """, params, as_dict=True)
    
    if records:
        names = [r.name for r in records]
        items = frappe.get_all("Borrowed Product Item",
            filters={"parent": ["in", names]},
            fields=["parent", "item_code", "qty"]
        )
        item_codes = list(set([i.item_code for i in items if i.item_code]))
        item_name_map = {}
        if item_codes:
            item_data = frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_name"])
            item_name_map = {d.name: (d.item_name or d.name) for d in item_data}

        items_map = {}
        for item in items:
            item["item_name"] = item_name_map.get(item.item_code, item.item_code)
            items_map.setdefault(item.parent, []).append(item)
        for r in records:
            r["items"] = items_map.get(r.name, [])
            
    return records

@frappe.whitelist()
def get_tank_levels(station=None):
    """
    Returns live tank levels based on the latest physical dip stick readings
    recorded in shift operations, with capacity, ullage, and gauge metrics.
    """
    params = []
    station_clause = ""
    if station:
        station_clause = "WHERE t.station = %s"
        params.append(station)

    sql = f"""
        SELECT 
            t.name as tank_name,
            t.tank_name as display_name,
            t.capacity,
            t.fuel_product,
            t.station,
            t.reorder_threshold,
            t.variance_tolerance,
            latest_dip.dip_value as last_dip_volume,
            latest_dip.opening_dip,
            latest_dip.closing_dip,
            latest_dip.dip_type,
            latest_dip.expected_stock,
            latest_dip.variance,
            latest_dip.shift_id,
            latest_dip.shift_date,
            latest_dip.shift_name_display,
            latest_dip.reading_time
        FROM `tabFuel Tank` t
        LEFT JOIN (
            SELECT 
                r.fuel_tank,
                CASE 
                    WHEN r.closing_dip > 0 THEN r.closing_dip 
                    ELSE r.opening_dip 
                END as dip_value,
                r.opening_dip,
                r.closing_dip,
                CASE 
                    WHEN r.closing_dip > 0 THEN 'Closing Dip' 
                    ELSE 'Opening Dip' 
                END as dip_type,
                r.expected_stock,
                r.variance,
                s.name as shift_id,
                s.shift_date,
                s.shift_name_display,
                r.creation as reading_time,
                ROW_NUMBER() OVER(PARTITION BY r.fuel_tank ORDER BY s.shift_date DESC, r.creation DESC) as rn
            FROM `tabDip Stick Reading` r
            INNER JOIN `tabShift` s ON r.parent = s.name
            WHERE (r.closing_dip > 0 OR r.opening_dip > 0)
        ) latest_dip ON t.name = latest_dip.fuel_tank AND latest_dip.rn = 1
        {station_clause}
        ORDER BY t.name
    """
    tanks = frappe.db.sql(sql, tuple(params), as_dict=True)

    total_capacity = 0.0
    total_volume = 0.0
    critical_count = 0

    for t in tanks:
        cap = flt(t.capacity) or 10000.0
        vol = flt(t.last_dip_volume) or 0.0
        pct = round((vol / cap) * 100, 1) if cap > 0 else 0.0
        ullage = max(0.0, cap - vol)
        threshold = flt(t.reorder_threshold) or 15.0

        if pct <= threshold:
            status = "critical"
            status_label = "CRITICAL REORDER"
            critical_count += 1
        elif pct <= 35.0:
            status = "low"
            status_label = "LOW STOCK"
        elif pct < 75.0:
            status = "normal"
            status_label = "NORMAL"
        else:
            status = "optimal"
            status_label = "OPTIMAL / FULL"

        p_name = (t.fuel_product or t.tank_name or "").upper()
        if "PETROL" in p_name or "PMS" in p_name or "SUPER" in p_name:
            fuel_category = "PMS"
            fuel_label = "Petrol (PMS)"
            fuel_color = "#0284c7"
            fuel_badge_bg = "#e0f2fe"
            fuel_badge_text = "#0369a1"
        elif "DIESEL" in p_name or "AGO" in p_name:
            fuel_category = "AGO"
            fuel_label = "Diesel (AGO)"
            fuel_color = "#d97706"
            fuel_badge_bg = "#fef3c7"
            fuel_badge_text = "#b45309"
        elif "KEROSENE" in p_name or "IK" in p_name:
            fuel_category = "IK"
            fuel_label = "Kerosene (IK)"
            fuel_color = "#7c3aed"
            fuel_badge_bg = "#f3e8ff"
            fuel_badge_text = "#6d28d9"
        else:
            fuel_category = "FUEL"
            fuel_label = t.fuel_product or "Fuel"
            fuel_color = "#475569"
            fuel_badge_bg = "#f1f5f9"
            fuel_badge_text = "#334155"

        t.capacity = cap
        t.max_capacity = cap
        t.current_volume = vol
        t.last_dip_volume = vol
        t.percentage = pct
        t.ullage = ullage
        t.status = status
        t.status_label = status_label
        t.fuel_category = fuel_category
        t.fuel_label = fuel_label
        t.fuel_color = fuel_color
        t.fuel_badge_bg = fuel_badge_bg
        t.fuel_badge_text = fuel_badge_text
        t.reorder_threshold = threshold
        t.formatted_time = frappe.utils.format_datetime(t.reading_time, "dd MMM yyyy, hh:mm a") if t.reading_time else "No dip recorded"
        t.shift_title = t.shift_name_display or t.shift_id or "N/A"

        total_capacity += cap
        total_volume += vol

    overall_pct = round((total_volume / total_capacity) * 100, 1) if total_capacity > 0 else 0.0
    overall_ullage = max(0.0, total_capacity - total_volume)

    return {
        "tanks": tanks,
        "summary": {
            "total_tanks": len(tanks),
            "total_capacity": total_capacity,
            "total_volume": total_volume,
            "overall_pct": overall_pct,
            "overall_ullage": overall_ullage,
            "critical_count": critical_count
        }
    }

@frappe.whitelist()
def get_pnl_summary(from_date=None, to_date=None, company=None, station=None):
    """Returns a structured, multi-tier Profit and Loss Statement for the selected period, optionally filtered by Station."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1)
    
    if not company:
        company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    if not frappe.db.exists("DocType", "GL Entry"):
        return {"error": "Accounting module not found."}

    # Normalize station parameter
    if station in ("ALL", "All Stations", "All Stations (Consolidated)", "", None):
        station = None

    gl_entries = frappe.db.sql("""
        SELECT 
            gl.account,
            a.account_name,
            a.root_type,
            a.parent_account,
            a.account_type,
            gl.voucher_type,
            gl.voucher_no,
            gl.debit,
            gl.credit,
            gl.remarks,
            gl.cost_center
        FROM `tabGL Entry` gl
        JOIN `tabAccount` a ON gl.account = a.name
        WHERE gl.posting_date >= %s AND gl.posting_date <= %s 
        AND gl.is_cancelled = 0
        AND (gl.company = %s OR %s IS NULL OR %s = '')
    """, (from_date, to_date, company, company, company), as_dict=True)

    se_warehouses = dict(frappe.db.sql("""
        SELECT name, CONCAT(COALESCE(from_warehouse, ''), ' | ', COALESCE(to_warehouse, ''), ' | ', COALESCE(remarks, ''))
        FROM `tabStock Entry`
        WHERE posting_date >= %s AND posting_date <= %s
    """, (from_date, to_date)))

    pi_warehouses = dict(frappe.db.sql("""
        SELECT pii.parent, GROUP_CONCAT(DISTINCT pii.warehouse)
        FROM `tabPurchase Invoice Item` pii
        JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
        WHERE pi.posting_date >= %s AND pi.posting_date <= %s
        GROUP BY pii.parent
    """, (from_date, to_date)))

    sr_warehouses = dict(frappe.db.sql("""
        SELECT sri.parent, GROUP_CONCAT(DISTINCT sri.warehouse)
        FROM `tabStock Reconciliation Item` sri
        JOIN `tabStock Reconciliation` sr ON sri.parent = sr.name
        WHERE sr.posting_date >= %s AND sr.posting_date <= %s
        GROUP BY sri.parent
    """, (from_date, to_date)))

    shift_stations = dict(frappe.db.sql("SELECT name, station FROM `tabShift`"))

    jv_remarks = dict(frappe.db.sql("""
        SELECT name, user_remark FROM `tabJournal Entry` 
        WHERE posting_date >= %s AND posting_date <= %s
    """, (from_date, to_date)))

    def attribute_entry(r):
        cc = (r.get('cost_center') or '').upper()
        if "GALANA" in cc:
            return "Galana Annex"
        if "RUBIS" in cc or "POA" in cc:
            return "RUBIS POA PLACE"

        acc_str = (r['account'] + " " + (r.get('account_name') or '')).upper()
        v_no = r.get('voucher_no') or ""
        v_type = r.get('voucher_type') or ""
        rem = (r.get('remarks') or '').upper()

        if "GALANA" in acc_str:
            return "Galana Annex"
        if "RUBIS" in acc_str:
            return "RUBIS POA PLACE"
        if v_type == "Stock Reconciliation" and v_no in sr_warehouses:
            sr_info = (sr_warehouses[v_no] or "").upper()
            if "GALANA" in sr_info:
                return "Galana Annex"
            elif "RUBIS" in sr_info or "POA" in sr_info:
                return "RUBIS POA PLACE"
        if v_type == "Stock Entry" and v_no in se_warehouses:
            se_info = se_warehouses[v_no].upper()
            if "GALANA" in se_info:
                return "Galana Annex"
            elif "RUBIS" in se_info or "POA" in se_info:
                return "RUBIS POA PLACE"
        if v_type == "Purchase Invoice" and v_no in pi_warehouses:
            pi_info = (pi_warehouses[v_no] or "").upper()
            if "GALANA" in pi_info:
                return "Galana Annex"
            elif "RUBIS" in pi_info or "POA" in pi_info:
                return "RUBIS POA PLACE"
        if v_type == "Journal Entry":
            j_rem = (jv_remarks.get(v_no) or rem).upper()
            for sh_name, sh_st in shift_stations.items():
                if sh_name.upper() in j_rem or sh_name.upper() in rem:
                    return sh_st
            if "GALANA" in j_rem:
                return "Galana Annex"
            elif "RUBIS" in j_rem:
                return "RUBIS POA PLACE"
        return None

    income_items = []
    cogs_items = []
    opex_items = []

    total_income = 0.0
    total_cogs = 0.0
    total_opex = 0.0

    # Aggregate entries by account after station attribution
    accounts_agg = {}
    for r in gl_entries:
        if r['root_type'] not in ('Income', 'Expense'):
            continue

        assigned_st = attribute_entry(r)

        if station:
            if assigned_st:
                if assigned_st.lower() != station.lower():
                    continue
            else:
                if "galana" in station.lower():
                    continue
                elif "rubis" in station.lower():
                    pass

        acc = r['account']
        if acc not in accounts_agg:
            accounts_agg[acc] = {
                "account": acc,
                "account_name": r['account_name'] or acc,
                "root_type": r['root_type'],
                "parent_account": r['parent_account'],
                "account_type": r['account_type'],
                "total_debit": 0.0,
                "total_credit": 0.0
            }
        accounts_agg[acc]["total_debit"] += flt(r['debit'])
        accounts_agg[acc]["total_credit"] += flt(r['credit'])

    # Calculate underlying Fuel vs Lube COGS components
    fuel_items = set(frappe.db.sql_list("SELECT name FROM tabItem WHERE item_group = 'FUELS' OR name IN ('DIESEL', 'Petrol 001', 'PMS', 'AGO', 'DPK')"))
    
    wh_pattern = None
    if station:
        if "galana" in station.lower():
            wh_pattern = "%Galana%"
        elif "rubis" in station.lower() or "poa" in station.lower():
            wh_pattern = "%POA%"

    # 1. Stock Entry Details (Fuel vs Lubes)
    if wh_pattern:
        se_details = frappe.db.sql('''
            SELECT sei.item_code, sei.amount
            FROM `tabStock Entry Detail` sei
            JOIN `tabStock Entry` se ON sei.parent = se.name
            WHERE se.posting_date >= %s AND se.posting_date <= %s
            AND se.docstatus = 1
            AND (se.from_warehouse LIKE %s OR se.remarks LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        se_details = frappe.db.sql('''
            SELECT sei.item_code, sei.amount
            FROM `tabStock Entry Detail` sei
            JOIN `tabStock Entry` se ON sei.parent = se.name
            WHERE se.posting_date >= %s AND se.posting_date <= %s
            AND se.docstatus = 1
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_se = sum(flt(r['amount']) for r in se_details if r['item_code'] in fuel_items)
    raw_lube_cogs_se = sum(flt(r['amount']) for r in se_details if r['item_code'] not in fuel_items)

    # 2. Purchase Invoices directly in COGS
    if wh_pattern:
        pi_details = frappe.db.sql('''
            SELECT pii.item_code, pii.amount
            FROM `tabPurchase Invoice Item` pii
            JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
            WHERE pi.posting_date >= %s AND pi.posting_date <= %s
            AND pii.expense_account = 'Cost of Goods Sold - KIL'
            AND pi.docstatus = 1
            AND (pii.warehouse LIKE %s OR pi.remarks LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        pi_details = frappe.db.sql('''
            SELECT pii.item_code, pii.amount
            FROM `tabPurchase Invoice Item` pii
            JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
            WHERE pi.posting_date >= %s AND pi.posting_date <= %s
            AND pii.expense_account = 'Cost of Goods Sold - KIL'
            AND pi.docstatus = 1
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_pi = sum(flt(r['amount']) for r in pi_details if r['item_code'] in fuel_items or not r['item_code'])
    raw_lube_cogs_pi = sum(flt(r['amount']) for r in pi_details if r['item_code'] and r['item_code'] not in fuel_items)

    # 3. Journal Entries hitting COGS
    if wh_pattern:
        jv_details = frappe.db.sql('''
            SELECT jv.user_remark, jvd.debit, jvd.credit
            FROM `tabJournal Entry Account` jvd
            JOIN `tabJournal Entry` jv ON jvd.parent = jv.name
            WHERE jv.posting_date >= %s AND jv.posting_date <= %s
            AND jvd.account = 'Cost of Goods Sold - KIL'
            AND jv.docstatus = 1
            AND (jv.user_remark LIKE %s OR jvd.cost_center LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        jv_details = frappe.db.sql('''
            SELECT jv.user_remark, jvd.debit, jvd.credit
            FROM `tabJournal Entry Account` jvd
            JOIN `tabJournal Entry` jv ON jvd.parent = jv.name
            WHERE jv.posting_date >= %s AND jv.posting_date <= %s
            AND jvd.account = 'Cost of Goods Sold - KIL'
            AND jv.docstatus = 1
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_jv = 0.0
    raw_lube_cogs_jv = 0.0
    for j in jv_details:
        net = flt(j['debit']) - flt(j['credit'])
        rem = (j.get('user_remark') or '').upper()
        if any(k in rem for k in ['FUEL', 'DIESEL', 'PETROL', 'PMS', 'AGO']):
            raw_fuel_cogs_jv += net
        else:
            raw_lube_cogs_jv += net

    # 4. Stock Reconciliation hitting COGS
    if wh_pattern:
        sr_details = frappe.db.sql('''
            SELECT sri.item_code, sri.amount_difference as amount
            FROM `tabStock Reconciliation Item` sri
            JOIN `tabStock Reconciliation` sr ON sri.parent = sr.name
            WHERE sr.posting_date >= %s AND sr.posting_date <= %s
            AND sr.docstatus = 1
            AND sr.expense_account = 'Cost of Goods Sold - KIL'
            AND (sri.warehouse LIKE %s OR sr.cost_center LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        sr_details = frappe.db.sql('''
            SELECT sri.item_code, sri.amount_difference as amount
            FROM `tabStock Reconciliation Item` sri
            JOIN `tabStock Reconciliation` sr ON sri.parent = sr.name
            WHERE sr.posting_date >= %s AND sr.posting_date <= %s
            AND sr.docstatus = 1
            AND sr.expense_account = 'Cost of Goods Sold - KIL'
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_sr = sum(flt(r['amount']) for r in sr_details if r['item_code'] in fuel_items)
    raw_lube_cogs_sr = sum(flt(r['amount']) for r in sr_details if r['item_code'] and r['item_code'] not in fuel_items)

    comp_fuel_cogs = raw_fuel_cogs_se + raw_fuel_cogs_pi + raw_fuel_cogs_jv + raw_fuel_cogs_sr
    comp_lube_cogs = raw_lube_cogs_se + raw_lube_cogs_pi + raw_lube_cogs_jv + raw_lube_cogs_sr
    comp_total = comp_fuel_cogs + comp_lube_cogs

    cogs_main_bal = 0.0
    other_cogs_items = []

    for r in accounts_agg.values():
        if r['root_type'] == 'Income':
            bal = flt(r['total_credit']) - flt(r['total_debit'])
            if abs(bal) > 0.001:
                acc_name_upper = (r['account_name'] or r['account']).upper()
                category = "fuel" if any(k in acc_name_upper for k in ["FUEL", "PETROL", "DIESEL", "PMS", "AGO"]) else "lubes"
                income_items.append({
                    "account": r['account'],
                    "account_name": r['account_name'],
                    "parent_account": r['parent_account'],
                    "category": category,
                    "amount": round(bal, 2),
                    "balance": round(bal, 2)
                })
                total_income += bal
        elif r['root_type'] == 'Expense':
            bal = flt(r['total_debit']) - flt(r['total_credit'])
            if abs(bal) > 0.001:
                is_cogs = (
                    r['account_type'] == 'Cost of Goods Sold' or 
                    'Stock Expenses' in (r['parent_account'] or '') or 
                    'Cost of Goods Sold' in (r['account_name'] or '') or
                    'Stock Adjustment' in (r['account_name'] or '')
                )
                if is_cogs:
                    if 'Cost of Goods Sold' in (r['account_name'] or ''):
                        cogs_main_bal += bal
                    else:
                        other_cogs_items.append({
                            "account": r['account'],
                            "account_name": r['account_name'],
                            "parent_account": r['parent_account'],
                            "category": "adjustment",
                            "amount": round(bal, 2),
                            "balance": round(bal, 2)
                        })
                    total_cogs += bal
                else:
                    opex_items.append({
                        "account": r['account'],
                        "account_name": r['account_name'],
                        "parent_account": r['parent_account'],
                        "amount": round(bal, 2),
                        "balance": round(bal, 2)
                    })
                    total_opex += bal

    # Split main Cost of Goods Sold balance into Fuel vs Lubes based on underlying transactions
    fuel_cogs_amount = 0.0
    lube_cogs_amount = 0.0
    if abs(cogs_main_bal) > 0.001:
        if comp_total > 0:
            fuel_ratio = comp_fuel_cogs / comp_total
            fuel_cogs_amount = round(cogs_main_bal * fuel_ratio, 2)
            lube_cogs_amount = round(cogs_main_bal - fuel_cogs_amount, 2)
        else:
            fuel_cogs_amount = round(cogs_main_bal, 2)
            lube_cogs_amount = 0.0

    if abs(fuel_cogs_amount) > 0.001:
        cogs_items.append({
            "account": "Cost of Fuel Sold",
            "account_name": "Cost of Goods Sold - Fuel (PMS & AGO)",
            "parent_account": "Stock Expenses - KIL",
            "category": "fuel",
            "amount": fuel_cogs_amount,
            "balance": fuel_cogs_amount
        })
    if abs(lube_cogs_amount) > 0.001:
        cogs_items.append({
            "account": "Cost of Lubes & Inventory",
            "account_name": "Cost of Goods Sold - Lubes & Inventory",
            "parent_account": "Stock Expenses - KIL",
            "category": "lubes",
            "amount": lube_cogs_amount,
            "balance": lube_cogs_amount
        })
    cogs_items.extend(other_cogs_items)

    total_income = round(total_income, 2)
    total_cogs = round(total_cogs, 2)
    total_opex = round(total_opex, 2)
    gross_profit = round(total_income - total_cogs, 2)
    gross_margin = round((gross_profit / total_income * 100), 2) if total_income else 0.0
    total_expense = round(total_cogs + total_opex, 2)
    net_profit = round(total_income - total_expense, 2)
    net_margin = round((net_profit / total_income * 100), 2) if total_income else 0.0

    fuel_income = sum(item["amount"] for item in income_items if item.get("category") == "fuel")
    lube_income = sum(item["amount"] for item in income_items if item.get("category") == "lubes")
    
    fuel_gross_profit = round(fuel_income - fuel_cogs_amount, 2)
    fuel_gross_margin = round((fuel_gross_profit / fuel_income * 100), 2) if fuel_income else 0.0
    
    lube_gross_profit = round(lube_income - lube_cogs_amount, 2)
    lube_gross_margin = round((lube_gross_profit / lube_income * 100), 2) if lube_income else 0.0

    # Calculate percentage share of turnover for each account
    for item in income_items:
        item["pct"] = round((item["amount"] / total_income * 100), 2) if total_income else 0.0
    for item in cogs_items:
        item["pct"] = round((item["amount"] / total_income * 100), 2) if total_income else 0.0
    for item in opex_items:
        item["pct"] = round((item["amount"] / total_income * 100), 2) if total_income else 0.0

    # Sort items by amount descending
    income_items.sort(key=lambda x: x["amount"], reverse=True)
    cogs_items.sort(key=lambda x: x["amount"], reverse=True)
    opex_items.sort(key=lambda x: x["amount"], reverse=True)

    return {
        "company": company,
        "station": station or "All Stations (Consolidated)",
        "period": f"{formatdate(from_date)} - {formatdate(to_date)}",
        "from_date": str(from_date),
        "to_date": str(to_date),
        "total_income": total_income,
        "fuel_income": round(fuel_income, 2),
        "lube_income": round(lube_income, 2),
        "total_cogs": total_cogs,
        "fuel_cogs": fuel_cogs_amount,
        "lube_cogs": lube_cogs_amount,
        "fuel_gross_profit": fuel_gross_profit,
        "fuel_gross_margin": fuel_gross_margin,
        "lube_gross_profit": lube_gross_profit,
        "lube_gross_margin": lube_gross_margin,
        "gross_profit": gross_profit,
        "gross_margin": gross_margin,
        "total_opex": total_opex,
        "total_expense": total_expense,
        "net_profit": net_profit,
        "net_margin": net_margin,
        "income_accounts": income_items,
        "cogs_accounts": cogs_items,
        "opex_accounts": opex_items,
        # backward compatibility:
        "expense_accounts": cogs_items + opex_items
    }


@frappe.whitelist()
def get_balance_sheet_summary(as_on_date=None, company=None, station=None):
    """
    Returns a comprehensive, multi-tier Balance Sheet (Statement of Financial Position)
    as of a selected date for the company, optionally filtered by station.
    """
    if not as_on_date:
        as_on_date = today()
        
    if not company:
        company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    if station in ("ALL", "All Stations", "All Stations (Consolidated)", "", None):
        station = None

    gl_data = frappe.db.sql("""
        SELECT 
            gl.account,
            a.account_name,
            a.root_type,
            a.parent_account,
            a.account_type,
            a.is_group,
            SUM(gl.debit) as total_debit,
            SUM(gl.credit) as total_credit
        FROM `tabGL Entry` gl
        JOIN `tabAccount` a ON gl.account = a.name
        WHERE gl.posting_date <= %s 
          AND gl.is_cancelled = 0
          AND (gl.company = %s OR %s IS NULL OR %s = '')
        GROUP BY gl.account
        ORDER BY a.root_type, a.parent_account, a.account_name
    """, (as_on_date, company, company, company), as_dict=True)

    if station:
        filtered_gl = []
        for r in gl_data:
            acc_str = (r['account'] + " " + (r.get('account_name') or '')).upper()
            if "galana" in station.lower():
                if "GALANA" in acc_str:
                    filtered_gl.append(r)
            elif "rubis" in station.lower():
                if "GALANA" not in acc_str:
                    filtered_gl.append(r)
        gl_data = filtered_gl

    assets_items = []
    liabilities_items = []
    equity_items = []
    
    total_assets = 0.0
    total_current_assets = 0.0
    total_non_current_assets = 0.0
    
    total_liabilities = 0.0
    total_current_liabilities = 0.0
    total_non_current_liabilities = 0.0
    
    total_equity = 0.0
    cum_income = 0.0
    cum_expense = 0.0

    for r in gl_data:
        debit = flt(r['total_debit'])
        credit = flt(r['total_credit'])
        acc_name = r['account_name'] or r['account']
        acc_type = r['account_type'] or ''
        parent = r['parent_account'] or ''
        
        if r['root_type'] == 'Asset':
            bal = debit - credit
            if abs(bal) > 0.001:
                is_cash_bank = acc_type in ('Cash', 'Bank') or 'Bank' in parent or 'Cash' in parent
                is_receivable = acc_type == 'Receivable' or 'Receivable' in parent or 'Debtor' in acc_name
                is_stock = acc_type == 'Stock' or 'Stock' in parent or 'Inventory' in acc_name
                is_fixed = acc_type in ('Fixed Asset', 'Accumulated Depreciation') or 'Fixed' in parent
                is_staff_short = 'Shortfall' in acc_name or 'CSA' in acc_name or 'Staff' in acc_name
                
                bucket = 'Other Current Assets'
                if is_cash_bank:
                    bucket = 'Cash & Bank Balances'
                elif is_staff_short:
                    bucket = 'Staff Shortfalls & Receivables'
                elif is_receivable:
                    bucket = 'Accounts Receivable (Debtors)'
                elif is_stock:
                    bucket = 'Inventories & Stock in Hand'
                elif 'Shift Control' in acc_name:
                    bucket = 'Station Shift Control & Clearing'
                elif is_fixed:
                    bucket = 'Property, Plant & Equipment (Fixed Assets)'
                    
                is_current = not is_fixed
                assets_items.append({
                    "account": r['account'],
                    "account_name": acc_name,
                    "parent_account": parent,
                    "account_type": acc_type,
                    "amount": round(bal, 2),
                    "bucket": bucket,
                    "is_current": is_current
                })
                total_assets += bal
                if is_current:
                    total_current_assets += bal
                else:
                    total_non_current_assets += bal

        elif r['root_type'] == 'Liability':
            bal = credit - debit
            if abs(bal) > 0.001:
                is_payable = acc_type == 'Payable' or 'Payable' in parent or 'Creditor' in acc_name
                is_tax = acc_type == 'Tax' or 'Tax' in parent or 'VAT' in acc_name or 'Payroll' in acc_name
                is_long = 'Long Term' in parent or 'Non-Current' in parent
                
                bucket = 'Other Liabilities'
                if is_payable:
                    bucket = 'Trade Accounts Payable (Creditors)'
                elif is_tax:
                    bucket = 'Duties, Taxes & Statutory Payables'
                elif 'Overdraft' in acc_name or 'Loan' in parent:
                    bucket = 'Loans & Borrowings'
                    
                is_current = not is_long
                liabilities_items.append({
                    "account": r['account'],
                    "account_name": acc_name,
                    "parent_account": parent,
                    "account_type": acc_type,
                    "amount": round(bal, 2),
                    "bucket": bucket,
                    "is_current": is_current
                })
                total_liabilities += bal
                if is_current:
                    total_current_liabilities += bal
                else:
                    total_non_current_liabilities += bal

        elif r['root_type'] == 'Equity':
            bal = credit - debit
            if abs(bal) > 0.001:
                equity_items.append({
                    "account": r['account'],
                    "account_name": acc_name,
                    "parent_account": parent,
                    "account_type": acc_type,
                    "amount": round(bal, 2),
                    "bucket": 'Capital & Reserves'
                })
                total_equity += bal

        elif r['root_type'] == 'Income':
            cum_income += (credit - debit)
        elif r['root_type'] == 'Expense':
            cum_expense += (debit - credit)

    provisional_profit = round(cum_income - cum_expense, 2)
    total_equity_with_profit = round(total_equity + provisional_profit, 2)
    total_liabilities_and_equity = round(total_liabilities + total_equity_with_profit, 2)
    
    total_assets = round(total_assets, 2)
    total_liabilities = round(total_liabilities, 2)
    total_current_assets = round(total_current_assets, 2)
    total_current_liabilities = round(total_current_liabilities, 2)
    total_non_current_assets = round(total_non_current_assets, 2)
    total_non_current_liabilities = round(total_non_current_liabilities, 2)
    
    working_capital = round(total_current_assets - total_current_liabilities, 2)
    current_ratio = round(total_current_assets / total_current_liabilities, 2) if total_current_liabilities else 0.0
    debt_to_equity = round(total_liabilities / total_equity_with_profit, 2) if total_equity_with_profit else 0.0
    
    difference = round(abs(total_assets - total_liabilities_and_equity), 2)
    is_balanced = difference <= 0.05

    def group_buckets(items, bucket_order=None):
        buckets_dict = {}
        for it in items:
            buckets_dict.setdefault(it['bucket'], []).append(it)
        res = []
        keys = list(buckets_dict.keys())
        if bucket_order:
            ordered_keys = [k for k in bucket_order if k in buckets_dict]
            remaining_keys = [k for k in keys if k not in bucket_order]
            keys = ordered_keys + remaining_keys
        for b_name in keys:
            b_items = buckets_dict[b_name]
            subtotal = sum(i['amount'] for i in b_items)
            res.append({
                "bucket_name": b_name,
                "subtotal": round(subtotal, 2),
                "items": b_items
            })
        return res

    asset_order = [
        'Cash & Bank Balances',
        'Accounts Receivable (Debtors)',
        'Staff Shortfalls & Receivables',
        'Inventories & Stock in Hand',
        'Station Shift Control & Clearing',
        'Other Current Assets',
        'Property, Plant & Equipment (Fixed Assets)'
    ]
    liability_order = [
        'Trade Accounts Payable (Creditors)',
        'Duties, Taxes & Statutory Payables',
        'Loans & Borrowings',
        'Other Liabilities'
    ]

    return {
        "as_on_date": str(as_on_date),
        "as_on_date_formatted": formatdate(as_on_date),
        "company": company,
        "station": station or "All Stations (Consolidated)",
        "summary": {
            "total_assets": total_assets,
            "current_assets": total_current_assets,
            "non_current_assets": total_non_current_assets,
            "total_liabilities": total_liabilities,
            "current_liabilities": total_current_liabilities,
            "non_current_liabilities": total_non_current_liabilities,
            "total_equity": total_equity,
            "provisional_profit": provisional_profit,
            "total_equity_and_reserves": total_equity_with_profit,
            "total_liabilities_and_equity": total_liabilities_and_equity,
            "working_capital": working_capital,
            "current_ratio": current_ratio,
            "debt_to_equity": debt_to_equity,
            "is_balanced": is_balanced,
            "difference": difference
        },
        "asset_groups": group_buckets(assets_items, asset_order),
        "liability_groups": group_buckets(liabilities_items, liability_order),
        "equity_groups": group_buckets(equity_items)
    }

    
@frappe.whitelist()
def get_employee_shorts(from_date=None, to_date=None, station=None):
    """Returns a summary of cash shortages per employee for the selected period."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1)
    
    params = [from_date, to_date]
    station_clause = ""
    if station and station not in ("ALL", "All Stations", ""):
        station_clause = " AND station = %s"
        params.append(station)

    shorts = frappe.db.sql(f"""
        SELECT owner as employee, SUM(cash_variance) as total_variance
        FROM `tabShift`
        WHERE docstatus < 2 
        AND shift_date >= %s AND shift_date <= %s {station_clause}
        GROUP BY owner
        HAVING total_variance != 0
        ORDER BY total_variance ASC
    """, params, as_dict=True)
    
    return {
        "shorts": shorts,
        "period": f"{formatdate(from_date)} to {formatdate(to_date)}"
    }

import re
from datetime import datetime, timedelta

def parse_lube_litres(item_code, item_name):
    txt = f"{item_code} {item_name}".upper()
    m_ml = re.search(r'(\d+(?:\.\d+)?)\s*ML\b', txt)
    if m_ml:
        try:
            return float(m_ml.group(1)) / 1000.0
        except Exception:
            pass
    m_l = re.search(r'(\d+(?:\.\d+)?)\s*L(?:TR|ITRE|ITRES|TRS)?\b', txt)
    if m_l:
        try:
            return float(m_l.group(1))
        except Exception:
            pass
    return 1.0

def parse_gas_kg(item_code, item_name):
    txt = f"{item_code} {item_name}".upper()
    m_kg = re.search(r'(\d+(?:\.\d+)?)\s*KG\b', txt)
    if m_kg:
        try:
            return float(m_kg.group(1))
        except Exception:
            pass
    return 1.0

def extract_kg_sort(val):
    txt = str(val or "").upper()
    m = re.search(r'(\d+(?:\.\d+)?)', txt)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    return 999.0

@frappe.whitelist()
def get_sales_analytics(from_date=None, to_date=None, station=None):
    if not to_date:
        to_date = today()
    if not from_date:
        # Default to 7 days window (today - 6 days to today)
        from_date = frappe.utils.add_days(to_date, -6)
        
    d_start = getdate(from_date)
    d_end = getdate(to_date)
    
    # Generate daily sequence of dates
    num_days = (d_end - d_start).days + 1
    date_list = [(d_start + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(num_days)]
    date_labels = [(d_start + timedelta(days=i)).strftime('%d %b') for i in range(num_days)]

    station_clause = ""
    station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        station_clause = " AND s.station = %s"
        station_args.append(station)

    # 1. Fuel Sales Breakdown & Time-Series
    fuel_readings = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            t.fuel_product as item_code,
            SUM(CASE WHEN UPPER(COALESCE(s.shift_template, '')) LIKE '%%DAY%%' THEN r.sales_quantity_electronic ELSE 0 END) as day_liters,
            SUM(CASE WHEN UPPER(COALESCE(s.shift_template, '')) LIKE '%%NIGHT%%' THEN r.sales_quantity_electronic ELSE 0 END) as night_liters,
            SUM(r.sales_quantity_electronic) as total_liters
        FROM `tabPump Meter Reading` r
        JOIN `tabShift` s ON r.parent = s.name
        LEFT JOIN `tabPump Nozzle` n ON r.pump_nozzle = n.name
        LEFT JOIN `tabFuel Tank` t ON n.fuel_tank = t.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND t.fuel_product IS NOT NULL {station_clause}
        GROUP BY s.shift_date, t.fuel_product
        ORDER BY s.shift_date ASC, t.fuel_product ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    # Pre-fetch pricing mapping with station price list fallback
    station_pl = frappe.db.get_value("Fuel Station", station, "default_selling_price_list") if (station and station not in ("ALL", "All Stations", "")) else None
    price_map = {}
    def get_price(item_code, shift_date):
        key = f"{item_code}_{shift_date}"
        if key in price_map:
            return price_map[key]
        price = 0.0
        if station_pl:
            p_rec = frappe.get_all("Item Price", 
                filters={"item_code": item_code, "price_list": station_pl, "valid_from": ("<=", shift_date)},
                fields=["price_list_rate"],
                order_by="valid_from desc",
                limit=1
            )
            if p_rec:
                price = flt(p_rec[0].price_list_rate)
        if not price:
            p_rec = frappe.get_all("Item Price", 
                filters={"item_code": item_code, "price_list": "Standard Selling", "valid_from": ("<=", shift_date)},
                fields=["price_list_rate"],
                order_by="valid_from desc",
                limit=1
            )
            if p_rec:
                price = flt(p_rec[0].price_list_rate)
        price_map[key] = price
        return price

    fuel_products = sorted(list(set(r.item_code for r in fuel_readings if r.item_code)))
    fuel_series = []
    fuel_summary = {}
    total_fuel_liters = 0.0
    total_fuel_revenue = 0.0

    for prod in fuel_products:
        daily_map = {d: 0.0 for d in date_list}
        tot_day = 0.0
        tot_night = 0.0
        tot_liters = 0.0
        tot_rev = 0.0
        
        for r in fuel_readings:
            if r.item_code == prod:
                sd = str(r.shift_date)
                if sd in daily_map:
                    daily_map[sd] += flt(r.total_liters or 0.0)
                tot_day += flt(r.day_liters or 0.0)
                tot_night += flt(r.night_liters or 0.0)
                tot_liters += flt(r.total_liters or 0.0)
                price = get_price(prod, sd)
                tot_rev += flt(r.total_liters or 0.0) * price
                
        fuel_series.append({
            "name": prod,
            "values": [round(daily_map[d], 2) for d in date_list]
        })
        
        fuel_summary[prod] = {
            "item_code": prod,
            "day_liters": round(tot_day, 2),
            "night_liters": round(tot_night, 2),
            "total_liters": round(tot_liters, 2),
            "revenue": round(tot_rev, 2)
        }
        total_fuel_liters += tot_liters
        total_fuel_revenue += tot_rev

    # 2. Lubes Sales (In Litres)
    lubes_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) = 'LUBES' {station_clause}
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_lubes_liters = {d: 0.0 for d in date_list}
    lubes_items_dict = {}
    total_lubes_liters = 0.0
    total_lubes_revenue = 0.0

    for row in lubes_raw:
        sd = str(row.shift_date)
        pack_l = parse_lube_litres(row.item_code, row.item_name)
        row_liters = flt(row.qty or 0.0) * pack_l
        if sd in daily_lubes_liters:
            daily_lubes_liters[sd] += row_liters
        
        code = row.item_code
        if code not in lubes_items_dict:
            lubes_items_dict[code] = {
                "item_code": code,
                "item_name": row.item_name or code,
                "pack_size": pack_l,
                "qty": 0.0,
                "total_liters": 0.0,
                "revenue": 0.0
            }
        lubes_items_dict[code]["qty"] += flt(row.qty or 0.0)
        lubes_items_dict[code]["total_liters"] += row_liters
        lubes_items_dict[code]["revenue"] += flt(row.revenue or 0.0)
        total_lubes_liters += row_liters
        total_lubes_revenue += flt(row.revenue or 0.0)

    lubes_list = sorted(lubes_items_dict.values(), key=lambda x: x["total_liters"], reverse=True)
    lubes_timeline = [round(daily_lubes_liters[d], 2) for d in date_list]

    # 3. Gas & Cylinders
    gas_cyl_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) IN ('GAS', 'CYLINDER') {station_clause}
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_gas_kgs = {d: 0.0 for d in date_list}
    daily_cylinders = {d: 0.0 for d in date_list}
    gas_items_dict = {}
    cyl_items_dict = {}
    total_gas_kgs = 0.0
    total_cylinders_count = 0.0
    total_gas_rev = 0.0
    total_cyl_rev = 0.0

    for row in gas_cyl_raw:
        sd = str(row.shift_date)
        grp = (row.item_group or "").upper()
        qty = flt(row.qty or 0.0)
        rev = flt(row.revenue or 0.0)
        code = row.item_code
        
        if "GAS" in grp:
            kg_rating = parse_gas_kg(row.item_code, row.item_name)
            tot_kg = qty * kg_rating
            if sd in daily_gas_kgs:
                daily_gas_kgs[sd] += tot_kg
            if code not in gas_items_dict:
                gas_items_dict[code] = {
                    "item_code": code,
                    "item_name": row.item_name or code,
                    "kg_rating": kg_rating,
                    "qty": 0.0,
                    "total_kg": 0.0,
                    "revenue": 0.0
                }
            gas_items_dict[code]["qty"] += qty
            gas_items_dict[code]["total_kg"] += tot_kg
            gas_items_dict[code]["revenue"] += rev
            total_gas_kgs += tot_kg
            total_gas_rev += rev
        elif "CYLINDER" in grp:
            if sd in daily_cylinders:
                daily_cylinders[sd] += qty
            if code not in cyl_items_dict:
                cyl_items_dict[code] = {
                    "item_code": code,
                    "item_name": row.item_name or code,
                    "qty": 0.0,
                    "revenue": 0.0
                }
            cyl_items_dict[code]["qty"] += qty
            cyl_items_dict[code]["revenue"] += rev
            total_cylinders_count += qty
            total_cyl_rev += rev

    gas_items_list = sorted(gas_items_dict.values(), key=lambda x: extract_kg_sort(x["item_code"]))
    cylinder_items_list = sorted(cyl_items_dict.values(), key=lambda x: extract_kg_sort(x["item_code"]))

    # 4. Filters & Accessories
    filters_acc_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) IN ('FILTERS', 'ACCESSORIES') {station_clause}
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_filters_qty = {d: 0.0 for d in date_list}
    filters_items_dict = {}
    total_filters_qty = 0.0
    total_filters_rev = 0.0

    for row in filters_acc_raw:
        sd = str(row.shift_date)
        qty = flt(row.qty or 0.0)
        rev = flt(row.revenue or 0.0)
        code = row.item_code
        if sd in daily_filters_qty:
            daily_filters_qty[sd] += qty
        if code not in filters_items_dict:
            filters_items_dict[code] = {
                "item_code": code,
                "item_name": row.item_name or code,
                "item_group": row.item_group or "FILTERS",
                "qty": 0.0,
                "revenue": 0.0
            }
        filters_items_dict[code]["qty"] += qty
        filters_items_dict[code]["revenue"] += rev
        total_filters_qty += qty
        total_filters_rev += rev

    filters_list = sorted(filters_items_dict.values(), key=lambda x: x["revenue"], reverse=True)

    # 5. Greasing Services
    greasing_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            g.vehicle_type,
            SUM(g.number_of_vehicles) as vehicles_count,
            SUM(g.total_amount) as revenue
        FROM `tabShift Greasing Sale` g
        JOIN `tabShift` s ON g.parent = s.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s {station_clause}
        GROUP BY s.shift_date, g.vehicle_type
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_greasing_vehicles = {d: 0.0 for d in date_list}
    daily_greasing_rev = {d: 0.0 for d in date_list}
    greasing_types_dict = {}
    total_greasing_vehicles = 0.0
    total_greasing_rev = 0.0

    for row in greasing_raw:
        sd = str(row.shift_date)
        v_cnt = flt(row.vehicles_count or 0.0)
        v_rev = flt(row.revenue or 0.0)
        vt = (row.vehicle_type or "OTHER").strip().upper()
        
        if sd in daily_greasing_vehicles:
            daily_greasing_vehicles[sd] += v_cnt
            daily_greasing_rev[sd] += v_rev
            
        if vt not in greasing_types_dict:
            greasing_types_dict[vt] = {
                "vehicle_type": vt,
                "vehicles_count": 0.0,
                "revenue": 0.0
            }
        greasing_types_dict[vt]["vehicles_count"] += v_cnt
        greasing_types_dict[vt]["revenue"] += v_rev
        total_greasing_vehicles += v_cnt
        total_greasing_rev += v_rev

    for vt, g_info in greasing_types_dict.items():
        g_info["avg_rate"] = round(g_info["revenue"] / g_info["vehicles_count"], 2) if g_info["vehicles_count"] > 0 else 0.0

    greasing_list = sorted(greasing_types_dict.values(), key=lambda x: x["revenue"], reverse=True)

    total_non_fuel_revenue = round(total_lubes_revenue + total_gas_rev + total_cyl_rev + total_filters_rev + total_greasing_rev, 2)

    return {
        "dates": date_list,
        "date_labels": date_labels,
        "fuel": {
            "products": fuel_products,
            "series": fuel_series,
            "summary": fuel_summary,
            "total_liters": round(total_fuel_liters, 2),
            "total_revenue": round(total_fuel_revenue, 2),
            "total_day_liters": round(sum(flt(fs.get("day_liters", 0)) for fs in fuel_summary.values()), 2),
            "total_night_liters": round(sum(flt(fs.get("night_liters", 0)) for fs in fuel_summary.values()), 2)
        },
        "lubes": {
            "timeline_liters": lubes_timeline,
            "total_liters": round(total_lubes_liters, 2),
            "total_qty": round(sum(flt(x["qty"]) for x in lubes_list), 2),
            "total_revenue": round(total_lubes_revenue, 2),
            "items": lubes_list
        },
        "gas": {
            "timeline_kgs": [round(daily_gas_kgs[d], 2) for d in date_list],
            "timeline_cylinders": [round(daily_cylinders[d], 2) for d in date_list],
            "total_kgs": round(total_gas_kgs, 2),
            "total_qty": round(sum(flt(g["qty"]) for g in gas_items_list), 2),
            "total_cylinders": round(total_cylinders_count, 2),
            "total_gas_revenue": round(total_gas_rev, 2),
            "total_cylinder_revenue": round(total_cyl_rev, 2),
            "total_revenue": round(total_gas_rev, 2),
            "gas_items": gas_items_list,
            "cylinder_items": cylinder_items_list,
            "items": gas_items_list
        },
        "cylinders": {
            "timeline_units": [round(daily_cylinders[d], 2) for d in date_list],
            "total_units": round(total_cylinders_count, 2),
            "total_revenue": round(total_cyl_rev, 2),
            "items": cylinder_items_list
        },
        "accessories": {
            "timeline_qty": [round(daily_filters_qty[d], 2) for d in date_list],
            "total_qty": round(total_filters_qty, 2),
            "total_revenue": round(total_filters_rev, 2),
            "items": filters_list
        },
        "greasing": {
            "timeline_vehicles": [round(daily_greasing_vehicles[d], 2) for d in date_list],
            "timeline_revenue": [round(daily_greasing_rev[d], 2) for d in date_list],
            "total_vehicles": round(total_greasing_vehicles, 2),
            "total_revenue": round(total_greasing_rev, 2),
            "items": greasing_list
        },
        "non_fuel": {
            "total_revenue": total_non_fuel_revenue,
            "lubes_revenue": round(total_lubes_revenue, 2),
            "lubes_liters": round(total_lubes_liters, 2),
            "gas_revenue": round(total_gas_rev, 2),
            "gas_kgs": round(total_gas_kgs, 2),
            "cylinders_revenue": round(total_cyl_rev, 2),
            "cylinders_count": round(total_cylinders_count, 2),
            "filters_revenue": round(total_filters_rev, 2),
            "filters_count": round(total_filters_qty, 2),
            "greasing_revenue": round(total_greasing_rev, 2),
            "greasing_vehicles": round(total_greasing_vehicles, 2)
        }
    }



@frappe.whitelist()
def get_topup_statement(from_date, to_date, station=None, status="all", search=None):
    station_topup_clause = ""
    station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        station_topup_clause = " AND s.station = %s"
        station_args.append(station)

    # 1. Get Opening Balance (Topups before from_date)
    op_topup_sql = f"""
        SELECT SUM(t.amount) as amt 
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE t.date < %s {station_topup_clause}
    """
    op_topups = frappe.db.sql(op_topup_sql, [from_date] + station_args, as_dict=1)
    op_topup_amt = op_topups[0].amt if op_topups and op_topups[0].amt else 0.0
    
    deduct_where = "je.docstatus = 1 AND (je.user_remark LIKE %s OR je.user_remark LIKE %s) AND jea.debit > 0 AND je.posting_date < %s"
    deduct_params = ['[TOP-UP DEDUCTION]%', '[TOP-UP RECONCILIATION]%', from_date]
    if station and station not in ("ALL", "All Stations", ""):
        deduct_where += " AND je.user_remark LIKE %s"
        deduct_params.append(f"%for {station}%")

    op_deductions = frappe.db.sql(f"""
        SELECT SUM(jea.debit) as amt 
        FROM `tabJournal Entry` je 
        JOIN `tabJournal Entry Account` jea ON je.name = jea.parent 
        WHERE {deduct_where}
    """, deduct_params, as_dict=1)
    op_deduct_amt = op_deductions[0].amt if op_deductions and op_deductions[0].amt else 0.0
    
    running_balance = op_topup_amt - op_deduct_amt

    # 2. Fetch Period Topups
    status_filter = ""
    if status == "pending":
        status_filter = " AND COALESCE(t.is_reconciled, 0) = 0"
    elif status == "reconciled":
        status_filter = " AND COALESCE(t.is_reconciled, 0) = 1"

    search_filter = ""
    search_params = []
    if search and search.strip():
        s_term = f"%{search.strip()}%"
        search_filter = " AND (t.name LIKE %s OR t.rrn_number LIKE %s OR t.card LIKE %s OR sc.supplier LIKE %s)"
        search_params = [s_term, s_term, s_term, s_term]

    topups = frappe.db.sql(f"""
        SELECT 
            t.name as entry_name, t.date, t.shift, t.card,
            COALESCE(sc.supplier, 'RUBIS KENYA') as supplier,
            COALESCE(sc.card_name, t.card) as card_name,
            t.mode_of_payment as mode, t.rrn_number as ref, t.amount,
            s.station, t.creation,
            COALESCE(t.is_reconciled, 0) as is_reconciled,
            t.reconciled_date, t.reconciled_by, t.reconciled_jv, t.reconciled_ref
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        LEFT JOIN `tabSupplier Card` sc ON t.card = sc.name
        WHERE t.date BETWEEN %s AND %s {station_topup_clause} {status_filter} {search_filter}
    """, [from_date, to_date] + station_args + search_params, as_dict=True)
    
    # 3. Deductions (only include in statement if status is 'all' or 'reconciled')
    deductions = []
    if status != "pending":
        period_deduct_where = "je.docstatus = 1 AND (je.user_remark LIKE %s OR je.user_remark LIKE %s) AND jea.debit > 0 AND je.posting_date BETWEEN %s AND %s"
        period_deduct_params = ['[TOP-UP DEDUCTION]%', '[TOP-UP RECONCILIATION]%', from_date, to_date]
        if station and station not in ("ALL", "All Stations", ""):
            period_deduct_where += " AND je.user_remark LIKE %s"
            period_deduct_params.append(f"%for {station}%")

        deductions = frappe.db.sql(f"""
            SELECT 
                je.name as entry_name, je.posting_date as date, '' as shift, 'RECONCILIATION' as supplier,
                'RECONCILIATION' as card_name, '' as mode, je.cheque_no as ref, (jea.debit * -1) as amount,
                '' as station, je.creation, 1 as is_reconciled, je.posting_date as reconciled_date,
                '' as reconciled_by, je.name as reconciled_jv, je.cheque_no as reconciled_ref
            FROM `tabJournal Entry` je
            JOIN `tabJournal Entry Account` jea ON je.name = jea.parent
            WHERE {period_deduct_where}
        """, period_deduct_params, as_dict=True)
    
    # 4. Summary counts & pending amount for station
    unrecon_where = "COALESCE(t.is_reconciled, 0) = 0"
    unrecon_params = []
    if station and station not in ("ALL", "All Stations", ""):
        unrecon_where += " AND s.station = %s"
        unrecon_params.append(station)

    pending_summary = frappe.db.sql(f"""
        SELECT 
            COUNT(*) as pending_count,
            COALESCE(SUM(t.amount), 0) as pending_amount
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE {unrecon_where}
    """, unrecon_params, as_dict=True)
    
    pending_count = pending_summary[0].pending_count if pending_summary else 0
    pending_amount = flt(pending_summary[0].pending_amount) if pending_summary else 0.0

    # Period totals
    period_topups_sum = sum(flt(t.get('amount', 0)) for t in topups)
    period_reconciled_sum = sum(flt(t.get('amount', 0)) for t in topups if t.get('is_reconciled') == 1)

    data = topups + deductions
    # Sort by date, then creation
    data.sort(key=lambda x: (str(x.get('date')), str(x.get('creation'))))
    
    result = []
    # Insert opening balance row
    result.append({
        "date": from_date,
        "entry_name": "OPENING BALANCE",
        "shift": "",
        "station": "",
        "supplier": "",
        "card_name": "",
        "mode": "",
        "ref": "",
        "amount": 0.0,
        "running_balance": running_balance,
        "is_opening": True,
        "is_reconciled": 0
    })
    
    for d in data:
        running_balance += flt(d.get('amount', 0.0))
        d['running_balance'] = running_balance
        result.append(d)
        
    return {
        "statement": result,
        "pending_amount": pending_amount,
        "pending_count": pending_count,
        "running_balance": running_balance,
        "period_topups_sum": period_topups_sum,
        "period_reconciled_sum": period_reconciled_sum
    }


@frappe.whitelist()
def create_topup_deduction(station, amount=None, credit_account=None, date=None, reference=None, supplier=None, topup_names=None):
    from frappe.utils import flt, today
    import json
    
    if not station or station in ("ALL", "All Stations", ""):
        frappe.throw("Please select a specific Fuel Station to reconcile.")
        
    holding_account = frappe.db.get_value("Fuel Station", station, "top_up_holding_account")
    if not holding_account:
        cand = f"Top Up Holding Account - {station} - KIL"
        if frappe.db.exists("Account", cand):
            holding_account = cand
            frappe.db.set_value("Fuel Station", station, "top_up_holding_account", cand)
        else:
            frappe.throw(f"No Top Up Holding Account configured for Station: {station}")
        
    company = frappe.db.get_value("Fuel Station", station, "company") or frappe.db.get_single_value("Global Defaults", "default_company") or "KILIBET INVESTMENT LTD"

    # Normalize topup_names
    parsed_topups = []
    if topup_names:
        if isinstance(topup_names, str):
            try:
                parsed_topups = json.loads(topup_names)
            except Exception:
                parsed_topups = [x.strip() for x in topup_names.split(",") if x.strip()]
        elif isinstance(topup_names, (list, tuple)):
            parsed_topups = list(topup_names)

    selected_topups = []
    if parsed_topups:
        selected_topups = frappe.db.sql("""
            SELECT t.name, t.amount, t.card, t.rrn_number, sc.supplier
            FROM `tabStation Supplier Top Up` t
            LEFT JOIN `tabSupplier Card` sc ON t.card = sc.name
            WHERE t.name IN %s
        """, (tuple(parsed_topups),), as_dict=True)
        if not amount or flt(amount) <= 0:
            amount = sum(flt(t.amount) for t in selected_topups)
        if not supplier and selected_topups:
            supplier = selected_topups[0].supplier or "RUBIS KENYA"
        if not reference and selected_topups:
            rrns = [t.rrn_number for t in selected_topups if t.rrn_number]
            reference = ", ".join(rrns)[:100]

    amount = flt(amount)
    if amount <= 0:
        frappe.throw("Amount to reconcile must be greater than zero.")
        
    if not supplier:
        supplier = "RUBIS KENYA"
        
    if not credit_account:
        credit_account = frappe.get_cached_value("Company", company, "default_payable_account") or "Creditors - KIL"
        
    if not date:
        date = today()
        
    if not reference:
        reference = f"RECON-{frappe.utils.nowdate()}"

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = date
    je.cheque_no = reference
    topups_tag = f" (Topups: {', '.join(parsed_topups)})" if parsed_topups else ""
    je.user_remark = f"[TOP-UP DEDUCTION] Reconciled to {credit_account} for {station}{topups_tag}"
    
    # 1. Debit the holding account (clears the holding balance)
    je.append("accounts", {
        "account": holding_account,
        "debit_in_account_currency": amount,
        "user_remark": f"Clear Top-Up Holding for {station}"
    })
    
    # 2. Credit the target account (Supplier Account / Creditors or Bank)
    acc_type = frappe.db.get_value("Account", credit_account, "account_type")
    credit_row = {
        "account": credit_account,
        "credit_in_account_currency": amount,
        "user_remark": f"Top-Up posted to {supplier or credit_account} (Ref: {reference})"
    }
    if acc_type == "Payable":
        credit_row["party_type"] = "Supplier"
        credit_row["party"] = supplier
        
    je.append("accounts", credit_row)
    je.flags.ignore_permissions = True
    je.insert()
    je.submit()

    # 3. Mark selected top-ups as reconciled
    if parsed_topups:
        user = frappe.session.user
        user_fullname = frappe.get_cached_value("User", user, "full_name") or user
        by_name = f"{user_fullname} ({user})"
        now_dt = frappe.utils.now_datetime()
        frappe.db.sql("""
            UPDATE `tabStation Supplier Top Up`
            SET is_reconciled = 1,
                reconciled_date = %s,
                reconciled_by = %s,
                reconciled_jv = %s,
                reconciled_ref = %s
            WHERE name IN %s
        """, (now_dt, by_name, je.name, reference, tuple(parsed_topups)))
        frappe.db.commit()

    return {
        "status": "success",
        "message": f"Successfully reconciled KES {amount:,.2f} and posted to {credit_account} ({supplier})",
        "jv": je.name,
        "amount": amount
    }


@frappe.whitelist()
def get_reconciliation_data(reconciliation_type="customer_payments", from_date=None, to_date=None, status="all", party_or_card=None, search=None, page=1, page_length=50, station=None):
    """
    Returns filtered transactions and summary statistics for Customer Payments or Station Cards.
    """
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1).strftime("%Y-%m-%d")

    page = int(page or 1)
    page_length = int(page_length or 50)
    offset = (page - 1) * page_length

    # 1. Customer Payments Reconciliation
    if reconciliation_type == "customer_payments":
        where_clauses = ["1=1"]
        params = {}

        if from_date:
            where_clauses.append("cp.date >= %(from_date)s")
            params["from_date"] = from_date
        if to_date:
            where_clauses.append("cp.date <= %(to_date)s")
            params["to_date"] = to_date

        if status == "pending":
            where_clauses.append("COALESCE(cp.is_reconciled, 0) = 0")
        elif status == "reconciled":
            where_clauses.append("COALESCE(cp.is_reconciled, 0) = 1")

        if party_or_card and party_or_card != "ALL":
            where_clauses.append("cp.customer = %(party)s")
            params["party"] = party_or_card

        if station and station not in ("ALL", "All Stations", ""):
            where_clauses.append("(s.station = %(station)s OR (cp.shift IS NULL AND c.station = %(station)s))")
            params["station"] = station

        if search:
            search_pattern = f"%{search.strip()}%"
            where_clauses.append("""(
                cp.name LIKE %(s)s 
                OR cp.trans_no LIKE %(s)s 
                OR cp.shift LIKE %(s)s 
                OR cp.customer LIKE %(s)s 
                OR c.customer_name LIKE %(s)s 
                OR e.employee_name LIKE %(s)s 
                OR cp.mode_of_payment LIKE %(s)s 
                OR cp.memo LIKE %(s)s
            )""")
            params["s"] = search_pattern

        where_str = " AND ".join(where_clauses)

        summary_res = frappe.db.sql(f"""
            SELECT 
                COUNT(*) as total_count,
                SUM(cp.amount) as total_amount,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 1 THEN 1 ELSE 0 END) as reconciled_count,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 1 THEN cp.amount ELSE 0 END) as reconciled_amount,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 0 THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 0 THEN cp.amount ELSE 0 END) as pending_amount
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            LEFT JOIN `tabEmployee` e ON cp.csa = e.name
            LEFT JOIN `tabShift` s ON cp.shift = s.name
            WHERE {where_str}
        """, params, as_dict=True)

        summary = summary_res[0] if summary_res else {}
        for k in ["total_count", "reconciled_count", "pending_count"]:
            summary[k] = int(summary.get(k) or 0)
        for k in ["total_amount", "reconciled_amount", "pending_amount"]:
            summary[k] = round(float(summary.get(k) or 0.0), 2)

        rows = frappe.db.sql(f"""
            SELECT 
                cp.name,
                cp.date,
                cp.shift,
                cp.trans_no,
                cp.customer,
                COALESCE(c.customer_name, cp.customer) as customer_name,
                cp.csa,
                COALESCE(e.employee_name, cp.csa) as csa_name,
                cp.mode_of_payment,
                cp.amount,
                cp.memo,
                COALESCE(cp.is_reconciled, 0) as is_reconciled,
                cp.reconciled_by,
                cp.reconciled_date
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            LEFT JOIN `tabEmployee` e ON cp.csa = e.name
            LEFT JOIN `tabShift` s ON cp.shift = s.name
            WHERE {where_str}
            ORDER BY cp.date DESC, cp.creation DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

        for r in rows:
            r["amount"] = round(float(r["amount"] or 0.0), 2)
            r["date_formatted"] = formatdate(r["date"])
            r["reconciled_date_formatted"] = frappe.utils.format_datetime(r["reconciled_date"]) if r.get("reconciled_date") else ""

        dropdown_where = "cp.customer IS NOT NULL AND cp.customer != ''"
        dropdown_params = {}
        if station and station not in ("ALL", "All Stations", ""):
            dropdown_where += " AND (s.station = %(station)s OR (cp.shift IS NULL AND c.station = %(station)s))"
            dropdown_params["station"] = station

        dropdown_options = frappe.db.sql(f"""
            SELECT DISTINCT cp.customer as id, COALESCE(c.customer_name, cp.customer) as label
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            LEFT JOIN `tabShift` s ON cp.shift = s.name
            WHERE {dropdown_where}
            ORDER BY label ASC
        """, dropdown_params, as_dict=True)

        return {
            "reconciliation_type": "customer_payments",
            "from_date": from_date,
            "to_date": to_date,
            "status": status,
            "records": rows,
            "summary": summary,
            "dropdown_options": dropdown_options,
            "page": page,
            "page_length": page_length,
            "total_pages": (summary["total_count"] + page_length - 1) // page_length if page_length else 1
        }

    # 2. Station Cards Reconciliation
    elif reconciliation_type == "station_cards":
        where_clauses = ["1=1"]
        params = {}

        if from_date:
            where_clauses.append("sc.date >= %(from_date)s")
            params["from_date"] = from_date
        if to_date:
            where_clauses.append("sc.date <= %(to_date)s")
            params["to_date"] = to_date

        if status == "pending":
            where_clauses.append("COALESCE(sc.is_reconciled, 0) = 0")
        elif status == "reconciled":
            where_clauses.append("COALESCE(sc.is_reconciled, 0) = 1")

        if party_or_card and party_or_card != "ALL":
            where_clauses.append("sc.card = %(card)s")
            params["card"] = party_or_card

        if station and station not in ("ALL", "All Stations", ""):
            where_clauses.append("s.station = %(station)s")
            params["station"] = station

        if search:
            search_pattern = f"%{search.strip()}%"
            where_clauses.append("""(
                sc.name LIKE %(s)s 
                OR sc.receipt_no LIKE %(s)s 
                OR sc.shift LIKE %(s)s 
                OR sc.card LIKE %(s)s 
                OR e.employee_name LIKE %(s)s 
                OR sc.memo LIKE %(s)s
            )""")
            params["s"] = search_pattern

        where_str = " AND ".join(where_clauses)

        summary_res = frappe.db.sql(f"""
            SELECT 
                COUNT(*) as total_count,
                SUM(sc.amount) as total_amount,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN 1 ELSE 0 END) as reconciled_count,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN sc.amount ELSE 0 END) as reconciled_amount,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN sc.amount ELSE 0 END) as pending_amount
            FROM `tabStation Cards` sc
            LEFT JOIN `tabEmployee` e ON sc.csa = e.name
            LEFT JOIN `tabShift` s ON sc.shift = s.name
            WHERE {where_str}
        """, params, as_dict=True)

        summary = summary_res[0] if summary_res else {}
        for k in ["total_count", "reconciled_count", "pending_count"]:
            summary[k] = int(summary.get(k) or 0)
        for k in ["total_amount", "reconciled_amount", "pending_amount"]:
            summary[k] = round(float(summary.get(k) or 0.0), 2)

        rows = frappe.db.sql(f"""
            SELECT 
                sc.name,
                sc.date,
                sc.shift,
                sc.receipt_no,
                sc.card,
                sc.csa,
                COALESCE(e.employee_name, sc.csa) as csa_name,
                sc.amount,
                sc.memo,
                COALESCE(sc.is_reconciled, 0) as is_reconciled,
                sc.reconciled_by,
                sc.reconciled_date
            FROM `tabStation Cards` sc
            LEFT JOIN `tabEmployee` e ON sc.csa = e.name
            LEFT JOIN `tabShift` s ON sc.shift = s.name
            WHERE {where_str}
            ORDER BY sc.date DESC, sc.creation DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

        for r in rows:
            r["amount"] = round(float(r["amount"] or 0.0), 2)
            r["date_formatted"] = formatdate(r["date"])
            r["reconciled_date_formatted"] = frappe.utils.format_datetime(r["reconciled_date"]) if r.get("reconciled_date") else ""

        dropdown_where = "sc.card IS NOT NULL AND sc.card != ''"
        dropdown_params = {}
        if station and station not in ("ALL", "All Stations", ""):
            dropdown_where += " AND s.station = %(station)s"
            dropdown_params["station"] = station

        dropdown_options = frappe.db.sql(f"""
            SELECT DISTINCT sc.card as id, sc.card as label
            FROM `tabStation Cards` sc
            LEFT JOIN `tabShift` s ON sc.shift = s.name
            WHERE {dropdown_where}
            ORDER BY label ASC
        """, dropdown_params, as_dict=True)

        return {
            "reconciliation_type": "station_cards",
            "from_date": from_date,
            "to_date": to_date,
            "status": status,
            "records": rows,
            "summary": summary,
            "dropdown_options": dropdown_options,
            "page": page,
            "page_length": page_length,
            "total_pages": (summary["total_count"] + page_length - 1) // page_length if page_length else 1
        }


@frappe.whitelist()
def toggle_reconciliation_status(doctype, names, is_reconciled=1):
    """
    Updates reconciliation flag for selected transactions.
    """
    if isinstance(names, str):
        try:
            names = json.loads(names)
        except Exception:
            names = [n.strip() for n in names.split(",") if n.strip()]

    if not names:
        return {"success": False, "message": "No records specified"}

    is_reconciled = 1 if (str(is_reconciled).lower() in ["1", "true"]) else 0
    user = frappe.session.user if is_reconciled else ""
    user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user
    by_name = f"{user_fullname} ({user})" if is_reconciled else ""
    now_dt = frappe.utils.now_datetime() if is_reconciled else None

    table_name = "tabCustomer Payment" if doctype in ["Customer Payment", "customer_payments"] else "tabStation Cards"

    if len(names) == 1:
        frappe.db.sql(f"""
            UPDATE `{table_name}`
            SET is_reconciled = %s,
                reconciled_by = %s,
                reconciled_date = %s
            WHERE name = %s
        """, (is_reconciled, by_name, now_dt, names[0]))
    else:
        frappe.db.sql(f"""
            UPDATE `{table_name}`
            SET is_reconciled = %s,
                reconciled_by = %s,
                reconciled_date = %s
            WHERE name IN %s
        """, (is_reconciled, by_name, now_dt, tuple(names)))

    frappe.db.commit()

    return {
        "success": True,
        "is_reconciled": is_reconciled,
        "count": len(names),
        "reconciled_by": by_name,
        "reconciled_date": frappe.utils.format_datetime(now_dt) if now_dt else ""
    }


@frappe.whitelist()
def get_executive_accounts(station=None):
    """
    Returns classified Cash & Bank and Supplier accounts for Executive Panel sidebar.
    Filters dynamically by operating station context.
    """
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    raw_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type, parent_account
        FROM `tabAccount`
        WHERE is_group = 0 
          AND (account_type IN ('Cash', 'Bank') OR LOCATE('A/C', name) > 0 OR LOCATE('GALANA', name) > 0 OR LOCATE('RUBIS', name) > 0)
          AND company = %s
          AND docstatus < 2
        ORDER BY FIELD(account_type, 'Cash', 'Bank'), name
    """, (company,), as_dict=True)

    cash_bank = []
    suppliers = []

    for acc in raw_accounts:
        acc_name = acc["name"]
        short_name = acc["account_name"] or acc_name.replace(" - KIL", "")
        acc_type = acc["account_type"]
        upper_name = acc_name.upper()

        # Calculate current live balance
        bal = frappe.db.sql("""
            SELECT SUM(debit - credit)
            FROM `tabGL Entry`
            WHERE account = %s AND is_cancelled = 0
        """, (acc_name,))[0][0] or 0.0

        item = {
            "name": acc_name,
            "label": short_name,
            "account_type": acc_type,
            "current_balance": round(flt(bal), 2),
            "station": ""
        }

        # Determine station association
        if "GALANA" in upper_name:
            item["station"] = "Galana Annex"
        elif "RUBIS" in upper_name:
            item["station"] = "RUBIS POA PLACE"
        elif "SHIFT MAIN CASH" in upper_name:
            item["station"] = "RUBIS POA PLACE"
        else:
            item["station"] = "" # Shared / General

        # Filter by station context if provided
        if station and station not in ("ALL", "All Stations", ""):
            # If account has station and doesn't match selected station, skip
            if item["station"] and item["station"].lower() != station.lower():
                continue

        # Separate Supplier Accounts from Cash & Bank
        if "GALANA A/C" in upper_name or "RUBIS A/C" in upper_name or "SUPPLIER" in upper_name or acc_type == "Payable":
            suppliers.append(item)
        elif acc_type in ("Cash", "Bank"):
            cash_bank.append(item)

    return {
        "cash_bank_accounts": cash_bank,
        "supplier_accounts": suppliers
    }


@frappe.whitelist()
def get_cash_accounts_overview(account=None, from_date=None, to_date=None, search=None, is_supplier=0):
    """
    Returns ledger, balances, and breakdown for Cash, Bank, or Supplier accounts.
    """
    from frappe.utils import cint
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = frappe.utils.add_days(to_date, -6)

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    is_supp = cint(is_supplier) or False
    if account:
        acc_upper = account.upper()
        if "GALANA A/C" in acc_upper or "RUBIS A/C" in acc_upper or "SUPPLIER" in acc_upper:
            is_supp = True

    # Determine default account if not supplied
    if not account:
        if is_supp:
            account = "GALANA A/C - KIL" if frappe.db.exists("Account", "GALANA A/C - KIL") else "RUBIS A/C - KIL"
        else:
            account = "Shift Main Cash - KIL"

    # Opening balance for selected account
    opening_bal = frappe.db.sql("""
        SELECT SUM(debit - credit)
        FROM `tabGL Entry`
        WHERE account = %s AND posting_date < %s AND is_cancelled = 0
    """, (account, from_date))[0][0] or 0.0
    opening_bal = round(flt(opening_bal), 2)

    # Period totals
    period_sums = frappe.db.sql("""
        SELECT SUM(debit) as total_in, SUM(credit) as total_out, COUNT(name) as total_txns
        FROM `tabGL Entry`
        WHERE account = %s 
          AND posting_date >= %s AND posting_date <= %s 
          AND is_cancelled = 0
    """, (account, from_date, to_date), as_dict=True)[0]

    total_in = round(flt(period_sums.total_in or 0.0), 2)
    total_out = round(flt(period_sums.total_out or 0.0), 2)
    net_change = round(total_in - total_out, 2)
    closing_bal = round(opening_bal + net_change, 2)

    # Transactions list
    where_extra = ""
    params = [account, from_date, to_date]
    if search:
        where_extra = " AND (voucher_no LIKE %s OR remarks LIKE %s OR against LIKE %s) "
        s_term = f"%{search}%"
        params.extend([s_term, s_term, s_term])

    txns = frappe.db.sql(f"""
        SELECT 
            name, posting_date, voucher_type, voucher_no, 
            debit, credit, against, remarks, creation
        FROM `tabGL Entry`
        WHERE account = %s 
          AND posting_date >= %s AND posting_date <= %s 
          AND is_cancelled = 0
          {where_extra}
        ORDER BY posting_date ASC, creation ASC, name ASC
    """, tuple(params), as_dict=True)

    running = opening_bal
    for t in txns:
        d = flt(t["debit"])
        c = flt(t["credit"])
        running += (d - c)
        t["running_balance"] = round(running, 2)
        t["debit"] = round(d, 2)
        t["credit"] = round(c, 2)
        t["date_formatted"] = formatdate(t["posting_date"])
        t["time_formatted"] = str(t.get("creation") or "")[11:19]

    # Reverse to show most recent first in UI
    txns.reverse()

    return {
        "account": account,
        "from_date": from_date,
        "to_date": to_date,
        "opening_balance": opening_bal,
        "total_inflows": total_in,
        "total_outflows": total_out,
        "total_debits": total_in,      # Payments Made
        "total_credits": total_out,    # Deliveries / Invoices
        "net_change": net_change,
        "closing_balance": closing_bal,
        "total_txns": len(txns),
        "transactions": txns,
        "is_supplier": is_supp
    }


@frappe.whitelist()
def get_director_expense_form_options():
    """
    Returns lists of available expense accounts and cash/bank accounts for the Director Expense form.
    """
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # Active leaf Expense Accounts
    expense_accounts = frappe.db.sql("""
        SELECT name, account_name
        FROM `tabAccount`
        WHERE is_group = 0 
          AND root_type = 'Expense'
          AND company = %s
          AND docstatus < 2
        ORDER BY account_name ASC
    """, (company,), as_dict=True)

    # Active leaf Cash & Bank Accounts
    payment_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 
          AND account_type IN ('Cash', 'Bank')
          AND company = %s
          AND docstatus < 2
        ORDER BY FIELD(account_type, 'Cash', 'Bank'), name ASC
    """, (company,), as_dict=True)

    return {
        "company": company,
        "expense_accounts": expense_accounts,
        "payment_accounts": payment_accounts
    }


@frappe.whitelist()
def submit_director_expense(date=None, paid_from_account=None, expense_account=None, amount=None, payee=None, description=None, reference_no=None):
    """
    Creates and submits a Journal Entry for director/executive expenses.
    Keeps it confidential and separated from Shift Operations SPA.
    """
    if not amount or flt(amount) <= 0:
        frappe.throw("Please enter a valid expense amount greater than 0.")
    if not paid_from_account:
        frappe.throw("Please select the Paid From account (Cash or Bank).")
    if not expense_account:
        frappe.throw("Please select the Expense Account / Category.")
    if not payee or not payee.strip():
        frappe.throw("Please specify the Payee / Beneficiary.")
    if not description or not description.strip():
        frappe.throw("Please provide an Expense Description / Business Purpose.")

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    posting_date = date or today()
    val_amount = flt(amount)

    user_remark = f"[EXECUTIVE EXPENSE] {description.strip()} | Payee: {payee.strip()}"
    if reference_no and reference_no.strip():
        user_remark += f" | Ref: {reference_no.strip()}"

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = posting_date
    je.user_remark = user_remark

    # Debit line: Expense Account
    je.append("accounts", {
        "account": expense_account,
        "debit_in_account_currency": val_amount,
        "credit_in_account_currency": 0.0,
        "user_remark": f"{payee} - {description}"
    })

    # Credit line: Cash / Bank Account
    je.append("accounts", {
        "account": paid_from_account,
        "debit_in_account_currency": 0.0,
        "credit_in_account_currency": val_amount,
        "user_remark": f"{payee} - {description}"
    })

    je.insert()
    je.submit()

    return {
        "success": True,
        "voucher_no": je.name,
        "amount": val_amount,
        "payee": payee,
        "posting_date": formatdate(posting_date),
        "message": f"Director Expense of KES {val_amount:,.2f} recorded and posted successfully ({je.name})."
    }


@frappe.whitelist()
def delete_director_expense(voucher_no):
    """
    Cancels and deletes an executive director expense Journal Entry,
    reversing all General Ledger impacts and restoring cash/bank balances.
    """
    if not voucher_no:
        frappe.throw("Voucher No is required.")

    if not frappe.db.exists("Journal Entry", voucher_no):
        frappe.throw(f"Journal Entry {voucher_no} does not exist.")

    je = frappe.get_doc("Journal Entry", voucher_no)

    # Cancel if submitted to reverse GL entries cleanly
    if je.docstatus == 1:
        je.cancel()

    # Delete the Journal Entry record
    frappe.delete_doc("Journal Entry", voucher_no, ignore_permissions=True)
    frappe.db.commit()

    return {
        "success": True,
        "voucher_no": voucher_no,
        "message": f"Expense voucher {voucher_no} deleted and cancelled successfully."
    }


@frappe.whitelist()
def update_director_expense(voucher_no, date, paid_from_account, expense_account, amount, payee, description, reference_no=None):
    """
    Updates an executive director expense by cancelling & replacing the Journal Entry
    with updated date, accounts, amount, payee, and description.
    """
    if not voucher_no:
        frappe.throw("Voucher No is required.")

    if not flt(amount) or flt(amount) <= 0:
        frappe.throw("Amount must be greater than zero.")
    if not paid_from_account:
        frappe.throw("Paid From (Cash / Bank) account is required.")
    if not expense_account:
        frappe.throw("Expense Category / Account is required.")
    if not payee or not payee.strip():
        frappe.throw("Please provide the Payee / Beneficiary.")
    if not description or not description.strip():
        frappe.throw("Please provide an Expense Description / Business Purpose.")

    if not frappe.db.exists("Journal Entry", voucher_no):
        frappe.throw(f"Journal Entry {voucher_no} does not exist.")

    old_je = frappe.get_doc("Journal Entry", voucher_no)
    company = old_je.company or frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # Cancel and delete old Journal Entry
    if old_je.docstatus == 1:
        old_je.cancel()
    frappe.delete_doc("Journal Entry", voucher_no, ignore_permissions=True)

    # Post new updated Journal Entry
    posting_date = date or today()
    val_amount = flt(amount)

    user_remark = f"[EXECUTIVE EXPENSE] {description.strip()} | Payee: {payee.strip()}"
    if reference_no and reference_no.strip():
        user_remark += f" | Ref: {reference_no.strip()}"

    new_je = frappe.new_doc("Journal Entry")
    new_je.voucher_type = "Journal Entry"
    new_je.company = company
    new_je.posting_date = posting_date
    new_je.user_remark = user_remark

    # Debit line: Expense Account
    new_je.append("accounts", {
        "account": expense_account,
        "debit_in_account_currency": val_amount,
        "credit_in_account_currency": 0.0,
        "user_remark": f"{payee} - {description}"
    })

    # Credit line: Cash / Bank Account
    new_je.append("accounts", {
        "account": paid_from_account,
        "debit_in_account_currency": 0.0,
        "credit_in_account_currency": val_amount,
        "user_remark": f"{payee} - {description}"
    })

    new_je.insert()
    new_je.submit()
    frappe.db.commit()

    return {
        "success": True,
        "voucher_no": new_je.name,
        "amount": val_amount,
        "payee": payee,
        "posting_date": formatdate(posting_date),
        "message": f"Director Expense updated and posted successfully ({new_je.name})."
    }


@frappe.whitelist()
def get_director_expenses_register(from_date=None, to_date=None, expense_account=None, paid_from_account=None, search=None):
    """
    Returns list of director/corporate expenses recorded via Journal Entry.
    """
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = frappe.utils.add_days(to_date, -29)

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    conditions = [
        "je.docstatus = 1", 
        "je.company = %(company)s", 
        "je.posting_date >= %(from_date)s", 
        "je.posting_date <= %(to_date)s"
    ]
    params = {
        "company": company,
        "from_date": from_date,
        "to_date": to_date
    }

    # Tag filter or non-shift, non-customer/shortage JEs
    conditions.append("(je.user_remark LIKE '%%[EXECUTIVE EXPENSE]%%' OR (je.user_remark NOT LIKE '%%Shift%%' AND je.user_remark NOT LIKE '%%Customer Payment%%' AND je.user_remark NOT LIKE '%%Shortage Payment%%'))")

    if search:
        conditions.append("(je.name LIKE %(search)s OR je.user_remark LIKE %(search)s)")
        params["search"] = f"%{search}%"

    cond_sql = " AND ".join(conditions)

    jes = frappe.db.sql(f"""
        SELECT 
            je.name as voucher_no,
            je.posting_date,
            je.user_remark,
            je.total_debit as amount,
            je.owner,
            je.creation
        FROM `tabJournal Entry` je
        WHERE {cond_sql}
        ORDER BY je.posting_date DESC, je.creation DESC
    """, params, as_dict=True)

    voucher_names = [j["voucher_no"] for j in jes]
    lines_by_voucher = {}
    if voucher_names:
        lines = frappe.db.sql("""
            SELECT 
                parent, account, debit, credit, user_remark
            FROM `tabJournal Entry Account`
            WHERE parent IN %s
            ORDER BY parent, idx
        """, (tuple(voucher_names),), as_dict=True)
        for l in lines:
            lines_by_voucher.setdefault(l["parent"], []).append(l)

    filtered_results = []
    total_expense = 0.0
    cash_expense = 0.0
    bank_expense = 0.0
    category_totals = {}

    for j in jes:
        acct_lines = lines_by_voucher.get(j["voucher_no"], [])

        exp_acc = None
        paid_acc = None
        for l in acct_lines:
            if flt(l.get("debit")) > 0:
                exp_acc = l.get("account")
            elif flt(l.get("credit")) > 0:
                paid_acc = l.get("account")

        if expense_account and exp_acc != expense_account:
            continue
        if paid_from_account and paid_acc != paid_from_account:
            continue

        amt = flt(j["amount"])
        total_expense += amt

        if paid_acc and "Cash" in paid_acc:
            cash_expense += amt
        else:
            bank_expense += amt

        if exp_acc:
            category_totals[exp_acc] = category_totals.get(exp_acc, 0.0) + amt

        raw_remark = j.get("user_remark") or ""
        clean_desc = raw_remark.replace("[EXECUTIVE EXPENSE]", "").strip()
        payee = ""
        ref_no = ""
        desc = clean_desc

        if " | Payee: " in clean_desc:
            parts = clean_desc.split(" | Payee: ")
            desc = parts[0].strip()
            rest = parts[1]
            if " | Ref: " in rest:
                p_parts = rest.split(" | Ref: ")
                payee = p_parts[0].strip()
                ref_no = p_parts[1].strip()
            else:
                payee = rest.strip()
        elif "Payee: " in clean_desc:
            parts = clean_desc.split("Payee: ")
            payee = parts[1].split("|")[0].strip()

        owner_name = frappe.get_cached_value("User", j["owner"], "full_name") or j["owner"]

        filtered_results.append({
            "voucher_no": j["voucher_no"],
            "posting_date": j["posting_date"],
            "date_formatted": formatdate(j["posting_date"]),
            "expense_account": exp_acc or "Unclassified",
            "paid_from_account": paid_acc or "General Cash/Bank",
            "amount": round(amt, 2),
            "payee": payee or "Not specified",
            "description": desc or clean_desc,
            "reference_no": ref_no or "-",
            "owner": owner_name,
            "raw_remark": raw_remark
        })

    top_cat = "None"
    top_cat_amt = 0.0
    for cat, c_amt in category_totals.items():
        if c_amt > top_cat_amt:
            top_cat_amt = c_amt
            top_cat = cat.replace(" - KIL", "")

    summary = {
        "total_expense": round(total_expense, 2),
        "cash_expense": round(cash_expense, 2),
        "bank_expense": round(bank_expense, 2),
        "count": len(filtered_results),
        "top_category": top_cat,
        "top_category_amount": round(top_cat_amt, 2)
    }

    return {
        "from_date": from_date,
        "to_date": to_date,
        "summary": summary,
        "records": filtered_results
    }


@frappe.whitelist()
def get_cards_holding_data(from_date=None, to_date=None, card_type=None, status=None, search=None, page=1, page_length=50, station=None):
    """
    Returns station cards from SPA for Cards Holding Account review, summary, and posting.
    """
    from frappe.utils import formatdate, cint, flt
    import json

    page = max(cint(page), 1)
    page_length = cint(page_length) or 50
    offset = (page - 1) * page_length

    where_clauses = ["1=1"]
    params = {}

    if from_date:
        where_clauses.append("sc.date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        where_clauses.append("sc.date <= %(to_date)s")
        params["to_date"] = to_date

    if card_type and card_type != "ALL":
        where_clauses.append("sc.card = %(card_type)s")
        params["card_type"] = card_type

    if station and station not in ("ALL", "All Stations", ""):
        where_clauses.append("s.station = %(station)s")
        params["station"] = station

    if status == "pending":
        where_clauses.append("COALESCE(sc.is_reconciled, 0) = 0")
    elif status == "posted":
        where_clauses.append("COALESCE(sc.is_reconciled, 0) = 1")

    if search:
        search_pattern = f"%{search.strip()}%"
        where_clauses.append("""(
            sc.name LIKE %(s)s 
            OR sc.receipt_no LIKE %(s)s 
            OR sc.shift LIKE %(s)s 
            OR sc.card LIKE %(s)s 
            OR e.employee_name LIKE %(s)s 
            OR sc.memo LIKE %(s)s
        )""")
        params["s"] = search_pattern

    where_str = " AND ".join(where_clauses)

    # 1. Summary Query
    summary_res = frappe.db.sql(f"""
        SELECT 
            COUNT(*) as total_count,
            SUM(sc.amount) as total_amount,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN 1 ELSE 0 END) as posted_count,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN sc.amount ELSE 0 END) as posted_amount,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN sc.amount ELSE 0 END) as pending_amount
        FROM `tabStation Cards` sc
        LEFT JOIN `tabEmployee` e ON sc.csa = e.name
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {where_str}
    """, params, as_dict=True)

    summary = summary_res[0] if summary_res else {}
    for k in ["total_count", "posted_count", "pending_count"]:
        summary[k] = int(summary.get(k) or 0)
    for k in ["total_amount", "posted_amount", "pending_amount"]:
        summary[k] = round(float(summary.get(k) or 0.0), 2)

    # 2. Paginated rows
    rows = frappe.db.sql(f"""
        SELECT 
            sc.name,
            sc.date,
            sc.shift,
            sc.receipt_no,
            sc.card,
            sc.csa,
            COALESCE(e.employee_name, sc.csa) as csa_name,
            sc.amount,
            sc.memo,
            COALESCE(sc.is_reconciled, 0) as is_reconciled,
            sc.reconciled_by,
            sc.reconciled_date
        FROM `tabStation Cards` sc
        LEFT JOIN `tabEmployee` e ON sc.csa = e.name
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {where_str}
        ORDER BY sc.date DESC, sc.creation DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

    for r in rows:
        r["amount"] = round(float(r["amount"] or 0.0), 2)
        r["date_formatted"] = formatdate(r["date"])
        r["reconciled_date_formatted"] = frappe.utils.format_datetime(r["reconciled_date"]) if r.get("reconciled_date") else ""

    # Available Card Types for dropdown
    ct_where = "sc.card IS NOT NULL AND sc.card != ''"
    ct_params = {}
    if station and station not in ("ALL", "All Stations", ""):
        ct_where += " AND s.station = %(station)s"
        ct_params["station"] = station

    card_types = frappe.db.sql(f"""
        SELECT DISTINCT sc.card as id, sc.card as label
        FROM `tabStation Cards` sc
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {ct_where}
        ORDER BY sc.card ASC
    """, ct_params, as_dict=True)

    # Available Supplier / Bank Accounts for posting dialog
    supplier_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 AND (
            name LIKE '%RUBIS%' 
            OR name LIKE '%CARD%' 
            OR name LIKE '%Creditor%'
            OR account_type IN ('Bank', 'Cash', 'Payable', 'Current Asset')
        )
        ORDER BY name ASC
    """, as_dict=True)

    return {
        "from_date": from_date,
        "to_date": to_date,
        "status": status,
        "card_type": card_type,
        "summary": summary,
        "records": rows,
        "card_types": card_types,
        "supplier_accounts": supplier_accounts,
        "page": page,
        "page_length": page_length,
        "total_pages": (summary["total_count"] + page_length - 1) // page_length if page_length else 1
    }


@frappe.whitelist()
def post_station_cards_to_supplier(card_names, supplier_account, posting_date=None, credited_amount=None, reference=None, variance_account=None, notes=None, create_gl_entry=0):
    """
    Posts selected station cards from holding to the supplier account with the amount actually credited.
    """
    from frappe.utils import now_datetime, flt, cint, today
    import json

    if isinstance(card_names, str):
        try:
            card_names = json.loads(card_names)
        except Exception:
            card_names = [n.strip() for n in card_names.split(",") if n.strip()]

    if not card_names:
        frappe.throw("No station cards selected for posting")

    if not supplier_account:
        frappe.throw("Please specify the Supplier Account that was credited")

    posting_date = posting_date or today()
    cards = frappe.get_all("Station Cards", filters={"name": ["in", card_names]}, fields=["name", "amount", "card", "receipt_no", "memo"])
    if not cards:
        frappe.throw("Selected cards not found in the system")

    cards_total = sum([flt(c.amount) for c in cards])
    credited_amt = flt(credited_amount) if (credited_amount is not None and str(credited_amount).strip() != "") else cards_total
    user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user
    by_name = f"{user_fullname} ({frappe.session.user})"
    now_dt = now_datetime()

    jv_name = None
    if cint(create_gl_entry):
        company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
        card_type = cards[0].card if cards else "Card"
        source_account = frappe.db.get_value("Station Card Type", card_type, "default_account") or "Shift Control Account - KIL"

        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = company
        je.posting_date = posting_date
        je.cheque_no = reference or f"CARDS-{len(cards)}"
        je.user_remark = f"[STATION CARDS POSTING] Posted {len(cards)} station cards (SPA Total: KES {cards_total:,.2f}) to Supplier Account: {supplier_account}. Credited: KES {credited_amt:,.2f}. {notes or ''}".strip()

        # Debit: Supplier account with credited amount
        supp_row = {
            "account": supplier_account,
            "debit_in_account_currency": credited_amt,
            "user_remark": f"Supplier Credit ({reference or 'Station Cards'})"
        }
        acc_type = frappe.db.get_value("Account", supplier_account, "account_type")
        if acc_type == "Payable":
            supp_row["party_type"] = "Supplier"
            supp_row["party"] = "RUBIS KENYA" if "RUBIS" in supplier_account.upper() else (frappe.get_all("Supplier", limit=1)[0].name if frappe.get_all("Supplier", limit=1) else None)
        je.append("accounts", supp_row)

        # Variance / Commission handling if credited differs from cards total
        variance = round(cards_total - credited_amt, 2)
        if variance > 0:
            var_acc = variance_account or "Commission on Sales - KIL"
            if not frappe.db.exists("Account", var_acc):
                var_acc = "Administrative Expenses - KIL"
            je.append("accounts", {
                "account": var_acc,
                "debit_in_account_currency": variance,
                "user_remark": "Card Processing Fee / Commission"
            })
        elif variance < 0:
            var_acc = variance_account or "Discounts Allowed - KIL"
            if not frappe.db.exists("Account", var_acc):
                var_acc = "Miscellaneous Expenses - KIL"
            je.append("accounts", {
                "account": var_acc,
                "credit_in_account_currency": abs(variance),
                "user_remark": "Supplier Bonus / Overage"
            })

        # Credit: Source Card Account with cards total
        je.append("accounts", {
            "account": source_account,
            "credit_in_account_currency": cards_total,
            "user_remark": f"Clear Holding: {len(cards)} cards"
        })

        je.flags.ignore_permissions = True
        je.insert()
        je.submit()
        jv_name = je.name

    # Update Station Cards status
    memo_suffix = f" [Posted to {supplier_account}: KES {credited_amt:,.2f} on {posting_date}{(' (Ref: ' + str(reference) + ')') if reference else ''}{(' (JV: ' + str(jv_name) + ')') if jv_name else ''}]"

    frappe.db.sql("""
        UPDATE `tabStation Cards`
        SET is_reconciled = 1,
            reconciled_by = %s,
            reconciled_date = %s,
            memo = CONCAT(IFNULL(memo, ''), %s)
        WHERE name IN %s
    """, (by_name, now_dt, memo_suffix, tuple(card_names)))

    frappe.db.commit()

    return {
        "success": True,
        "message": f"Successfully posted {len(card_names)} cards (KES {cards_total:,.2f}) to {supplier_account}!",
        "count": len(card_names),
        "total_amount": cards_total,
        "credited_amount": credited_amt,
        "supplier_account": supplier_account,
        "journal_entry": jv_name
    }


@frappe.whitelist()
def undo_station_cards_posting(card_names):
    """
    Reverts station cards back to pending holding status.
    """
    import json
    if isinstance(card_names, str):
        try:
            card_names = json.loads(card_names)
        except Exception:
            card_names = [n.strip() for n in card_names.split(",") if n.strip()]

    if not card_names:
        frappe.throw("No station cards specified")

    frappe.db.sql("""
        UPDATE `tabStation Cards`
        SET is_reconciled = 0,
            reconciled_by = NULL,
            reconciled_date = NULL
        WHERE name IN %s
    """, (tuple(card_names),))

    frappe.db.commit()
    return {"success": True, "message": f"{len(card_names)} card(s) reverted to pending in holding."}


@frappe.whitelist()
def get_supplier_payment_form_data(supplier=None, station=None, account=None):
    """
    Returns data needed for the Transfer to Supplier & Invoices Reconcile modal:
    - active Bank Accounts with live balance (prioritized / filtered by station)
    - active Card Accounts with live balance
    - suppliers list (prioritized by station)
    - outstanding Purchase Invoices filtered by selected station and supplier
    """
    from frappe.utils import formatdate, flt
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # Infer station if not explicitly provided
    if not station or station in ("ALL", "All Stations", ""):
        if account:
            acc_u = account.upper()
            if "GALANA" in acc_u:
                station = "Galana Annex"
            elif "RUBIS" in acc_u or "SHIFT MAIN CASH" in acc_u:
                station = "RUBIS POA PLACE"
        elif supplier:
            sup_u = supplier.upper()
            if "GALANA" in sup_u:
                station = "Galana Annex"
            elif "RUBIS" in sup_u:
                station = "RUBIS POA PLACE"

    bank_accs = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 
          AND (account_type IN ('Bank', 'Cash') OR parent_account = 'Bank Accounts - KIL')
          AND company = %s
          AND docstatus < 2
        ORDER BY account_name ASC
    """, (company,), as_dict=True)

    bank_accounts = []
    card_accounts = []
    for acc in bank_accs:
        bal = frappe.db.sql("""
            SELECT SUM(debit - credit) FROM `tabGL Entry` 
            WHERE account = %s AND is_cancelled = 0
        """, (acc["name"],))[0][0] or 0.0
        acc["balance"] = round(flt(bal), 2)
        
        acc_upper = acc["name"].upper()
        # Tag account station
        if "GALANA" in acc_upper:
            acc["station"] = "Galana Annex"
        elif "RUBIS" in acc_upper or "SHIFT MAIN CASH" in acc_upper:
            acc["station"] = "RUBIS POA PLACE"
        else:
            acc["station"] = "" # Shared / General

        if "RUBIS A/C" in acc_upper or "GALANA A/C" in acc_upper or "CARD" in acc_upper:
            if not station or not acc["station"] or acc["station"].lower() == station.lower():
                card_accounts.append(acc)
        else:
            if not station or not acc["station"] or acc["station"].lower() == station.lower():
                bank_accounts.append(acc)

    # Sort so accounts specifically belonging to the active station appear on top
    if station:
        bank_accounts.sort(key=lambda a: (0 if a.get("station", "").lower() == station.lower() else 1, a["name"]))
        card_accounts.sort(key=lambda a: (0 if a.get("station", "").lower() == station.lower() else 1, a["name"]))

    suppliers = frappe.get_all("Supplier", fields=["name", "supplier_name"], order_by="supplier_name asc")
    
    # Determine default supplier based on station context
    default_supplier = ""
    if station:
        if "galana" in station.lower():
            galana_sup = next((s["name"] for s in suppliers if "galana" in s["name"].lower()), "")
            if galana_sup:
                default_supplier = galana_sup
        elif "rubis" in station.lower():
            rubis_sup = next((s["name"] for s in suppliers if "rubis" in s["name"].lower()), "")
            if rubis_sup:
                default_supplier = rubis_sup

    if not default_supplier:
        default_supplier = "RUBIS KENYA" if any(s["name"] == "RUBIS KENYA" for s in suppliers) else (suppliers[0]["name"] if suppliers else "")

    active_supplier = supplier or default_supplier

    invoices = []
    total_outstanding = 0.0

    where_clauses = ["pi.docstatus = 1", "pi.outstanding_amount > 0"]
    params = []

    if active_supplier:
        where_clauses.append("pi.supplier = %s")
        params.append(active_supplier)

    if station and station not in ("ALL", "All Stations", ""):
        if "galana" in station.lower():
            where_clauses.append("(LOCATE('Galana', pi.supplier) > 0 OR LOCATE('Galana', pii.warehouse) > 0)")
        elif "rubis" in station.lower():
            where_clauses.append("(LOCATE('RUBIS', pi.supplier) > 0 OR LOCATE('Rubis', pii.warehouse) > 0)")

    where_str = " AND ".join(where_clauses)
    inv_sql = f"""
        SELECT pi.name, pi.supplier, pi.posting_date, pi.due_date, pi.grand_total, pi.outstanding_amount, pi.bill_no,
               GROUP_CONCAT(DISTINCT pii.warehouse) as warehouses
        FROM `tabPurchase Invoice` pi
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE {where_str}
        GROUP BY pi.name
        ORDER BY pi.posting_date ASC, pi.name ASC
    """
    inv_rows = frappe.db.sql(inv_sql, tuple(params), as_dict=True)

    for r in inv_rows:
        r["grand_total"] = round(flt(r["grand_total"]), 2)
        r["outstanding_amount"] = round(flt(r["outstanding_amount"]), 2)
        r["posting_date_formatted"] = formatdate(r["posting_date"])
        r["due_date_formatted"] = formatdate(r["due_date"]) if r.get("due_date") else ""
        
        # Tag invoice station
        wh = str(r.get("warehouses") or "")
        sup = str(r.get("supplier") or "")
        if "galana" in wh.lower() or "galana" in sup.lower():
            r["station"] = "Galana Annex"
        elif "rubis" in wh.lower() or "rubis" in sup.lower():
            r["station"] = "RUBIS POA PLACE"
        else:
            r["station"] = "Consolidated"

        total_outstanding += r["outstanding_amount"]
    invoices = inv_rows

    return {
        "bank_accounts": bank_accounts,
        "card_accounts": card_accounts,
        "suppliers": suppliers,
        "station": station or "",
        "default_supplier": active_supplier,
        "invoices": invoices,
        "total_outstanding": round(total_outstanding, 2)
    }


@frappe.whitelist()
def submit_supplier_bank_transfer(paid_from_account, supplier, amount, posting_date=None, reference=None, invoice_names=None, remarks=None, payment_type_mode="bank_transfer"):
    """
    Creates and submits an official ERPNext Payment Entry from Bank Account or Card Holding Account to Supplier.
    Settles outstanding fuel Purchase Invoices (FIFO or specifically selected).
    """
    from frappe.utils import flt, today, formatdate, now_datetime
    import json

    if not amount or flt(amount) <= 0:
        frappe.throw("Please enter a valid amount greater than 0.")
    if not paid_from_account:
        frappe.throw("Please select the source account (Paid From).")
    if not supplier:
        frappe.throw("Please select the Supplier.")

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    posting_date = posting_date or today()
    val_amount = flt(amount)

    payable_account = frappe.db.get_value("Supplier", supplier, "default_payable_account") or "Creditors - KIL"

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.company = company
    pe.posting_date = posting_date
    pe.party_type = "Supplier"
    pe.party = supplier
    pe.paid_from = paid_from_account
    pe.paid_to = payable_account
    pe.paid_amount = val_amount
    pe.received_amount = val_amount
    pe.reference_no = reference or ""
    pe.reference_date = posting_date
    prefix = "[SUPPLIER BANK TRANSFER]" if payment_type_mode == "bank_transfer" else "[CARD HOLDING RECONCILIATION]"
    pe.remarks = f"{prefix} Paid KES {val_amount:,.2f} to {supplier} from {paid_from_account}. {remarks or ''}".strip()

    # Parse selected invoices if provided
    parsed_invoices = []
    if invoice_names:
        if isinstance(invoice_names, str):
            try:
                parsed_invoices = json.loads(invoice_names)
            except Exception:
                parsed_invoices = [i.strip() for i in invoice_names.split(",") if i.strip()]
        elif isinstance(invoice_names, list):
            parsed_invoices = invoice_names

    inv_filter = {"supplier": supplier, "docstatus": 1, "outstanding_amount": [">", 0]}
    if parsed_invoices:
        inv_filter["name"] = ["in", parsed_invoices]

    outstanding_invoices = frappe.get_all(
        "Purchase Invoice",
        filters=inv_filter,
        fields=["name", "outstanding_amount", "grand_total", "posting_date"],
        order_by="posting_date asc, name asc"
    )

    remaining_to_allocate = val_amount
    allocated_invoices = []

    for inv in outstanding_invoices:
        if remaining_to_allocate <= 0:
            break
        alloc_amt = min(flt(inv["outstanding_amount"]), remaining_to_allocate)
        pe.append("references", {
            "reference_doctype": "Purchase Invoice",
            "reference_name": inv["name"],
            "total_amount": inv["grand_total"],
            "outstanding_amount": inv["outstanding_amount"],
            "allocated_amount": alloc_amt
        })
        remaining_to_allocate -= alloc_amt
        allocated_invoices.append(inv["name"])

    pe.flags.ignore_permissions = True
    pe.insert()
    pe.submit()

    # If this was a card holding offset, update tabStation Cards status
    cards_reconciled_count = 0
    if payment_type_mode == "card_offset":
        card_type = "RUBIS CARD" if "RUBIS" in paid_from_account.upper() else ""
        card_where = "COALESCE(is_reconciled, 0) = 0"
        card_params = {}
        if card_type:
            card_where += " AND card = %(ct)s"
            card_params["ct"] = card_type

        pending_cards = frappe.db.sql(f"""
            SELECT name, amount FROM `tabStation Cards`
            WHERE {card_where}
            ORDER BY date ASC, creation ASC
        """, card_params, as_dict=True)

        card_rem = val_amount
        cards_to_update = []
        for c in pending_cards:
            if card_rem <= 0:
                break
            cards_to_update.append(c["name"])
            card_rem -= flt(c["amount"])

        if cards_to_update:
            user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user
            by_name = f"{user_fullname} ({frappe.session.user})"
            memo_text = f" [Reconciled to {supplier} via Payment Entry {pe.name}]"
            frappe.db.sql("""
                UPDATE `tabStation Cards`
                SET is_reconciled = 1,
                    reconciled_by = %s,
                    reconciled_date = %s,
                    memo = CONCAT(IFNULL(memo, ''), %s)
                WHERE name IN %s
            """, (by_name, now_datetime(), memo_text, tuple(cards_to_update)))
            frappe.db.commit()
            cards_reconciled_count = len(cards_to_update)

    return {
        "success": True,
        "payment_entry": pe.name,
        "amount": val_amount,
        "supplier": supplier,
        "paid_from": paid_from_account,
        "allocated_invoices": allocated_invoices,
        "cards_reconciled_count": cards_reconciled_count,
        "message": f"Successfully created Payment Entry {pe.name} of KES {val_amount:,.2f} to {supplier}!"
    }


@frappe.whitelist()
def get_supplier_payments_register(supplier=None, from_date=None, to_date=None, search=None, page=1, page_length=50):
    """
    Returns history of supplier payments and card offset settlements.
    """
    from frappe.utils import formatdate, cint, flt
    page = cint(page) or 1
    page_length = cint(page_length) or 50
    offset = (page - 1) * page_length

    where_clauses = ["pe.docstatus = 1", "pe.party_type = 'Supplier'"]
    params = {}

    if supplier and supplier not in ("ALL", "All Suppliers", ""):
        where_clauses.append("pe.party = %(supplier)s")
        params["supplier"] = supplier

    if from_date:
        where_clauses.append("pe.posting_date >= %(from_date)s")
        params["from_date"] = from_date

    if to_date:
        where_clauses.append("pe.posting_date <= %(to_date)s")
        params["to_date"] = to_date

    if search:
        where_clauses.append("(pe.name LIKE %(s)s OR pe.party LIKE %(s)s OR pe.paid_from LIKE %(s)s OR pe.reference_no LIKE %(s)s OR pe.remarks LIKE %(s)s)")
        params["s"] = f"%{search.strip()}%"

    where_str = " AND ".join(where_clauses)

    total_count = frappe.db.sql(f"""
        SELECT COUNT(name) FROM `tabPayment Entry` pe
        WHERE {where_str}
    """, params)[0][0] or 0

    total_paid = frappe.db.sql(f"""
        SELECT SUM(paid_amount) FROM `tabPayment Entry` pe
        WHERE {where_str}
    """, params)[0][0] or 0.0

    rows = frappe.db.sql(f"""
        SELECT 
            pe.name, pe.posting_date, pe.party as supplier,
            pe.paid_from, pe.paid_amount, pe.reference_no,
            pe.remarks, pe.creation, pe.owner
        FROM `tabPayment Entry` pe
        WHERE {where_str}
        ORDER BY pe.posting_date DESC, pe.creation DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

    for r in rows:
        r["paid_amount"] = round(flt(r["paid_amount"]), 2)
        r["posting_date_formatted"] = formatdate(r["posting_date"])
        # Fetch references if any
        refs = frappe.get_all("Payment Entry Reference", filters={"parent": r["name"]}, fields=["reference_name", "allocated_amount"])
        r["references_summary"] = ", ".join([f"{ref['reference_name']} (KES {flt(ref['allocated_amount']):,.2f})" for ref in refs]) if refs else "On Account"

    return {
        "records": rows,
        "total_count": total_count,
        "total_paid": round(flt(total_paid), 2),
        "page": page,
        "page_length": page_length,
        "total_pages": (total_count + page_length - 1) // page_length if page_length else 1
    }


# ========================================================
# M-PESA RECONCILIATION & TILL AUDITING MODULE
# ========================================================

@frappe.whitelist()
def get_mpesa_reconciliation_data(from_date=None, to_date=None, station=None, till=None, status_filter=None):
    """
    Returns itemized shift M-Pesa records, transfer routings, and audit status.
    Performs carryover check, math discrepancy check, and unverified transfer audit.
    """
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = add_days(to_date, -30)

    conditions = ["s.docstatus < 2", "DATE(s.shift_date) >= %s", "DATE(s.shift_date) <= %s"]
    params = [from_date, to_date]

    if station and station not in ("ALL", "All Stations", ""):
        conditions.append("s.station = %s")
        params.append(station)

    if till and till not in ("ALL", "All Tills", ""):
        conditions.append("mp.mpesa_till = %s")
        params.append(till)

    where_clause = " AND ".join(conditions)

    # 1. Fetch shift mpesa readings
    shift_rows = frappe.db.sql(f"""
        SELECT 
            mp.name, mp.parent as shift_id, s.station, s.shift_date, s.status as shift_status,
            mp.mpesa_till, mp.csa, mp.opening_balance, mp.closing_balance, mp.transfers_made, mp.amount, mp.posted,
            mp.bank_name, mp.destination_account, mp.audit_status, mp.statement_ref, mp.audit_note,
            mp.verified_by, mp.verified_on
        FROM `tabShift M-Pesa Payment` mp
        JOIN `tabShift` s ON s.name = mp.parent
        WHERE {where_clause}
        ORDER BY mp.mpesa_till ASC, s.shift_date ASC, s.creation ASC
    """, params, as_dict=True)

    # Resolve CSA employee names
    csa_ids = list(set([r.csa for r in shift_rows if r.csa]))
    csa_name_map = {}
    if csa_ids:
        emp_data = frappe.get_all("Employee", filters={"name": ["in", csa_ids]}, fields=["name", "employee_name"])
        csa_name_map = {e.name: (e.employee_name or e.name) for e in emp_data}

    # 2. Perform Intelligent Carryover & Math Auditing
    audited_shifts = []
    till_chains = {}
    for r in shift_rows:
        till_chains.setdefault(r.mpesa_till, []).append(r)

    total_collections = 0.0
    total_transfers = 0.0
    total_discrepancies = 0
    total_verified = 0
    total_pending = 0

    for t_name, rows in till_chains.items():
        prev_closing = None
        for i, row in enumerate(rows):
            row["csa_name"] = csa_name_map.get(row.csa, row.csa or "Unassigned")
            opening = flt(row.opening_balance)
            closing = flt(row.closing_balance)
            transfers = flt(row.transfers_made)
            recorded_amount = flt(row.amount)

            total_collections += recorded_amount
            total_transfers += transfers

            expected_closing = opening + recorded_amount - transfers
            calc_collections = closing - opening + transfers

            flags = []

            # Check 1: Carryover continuity (Shift N opening vs Shift N-1 closing)
            carryover_mismatch = False
            if prev_closing is not None and abs(opening - prev_closing) > 0.01:
                carryover_mismatch = True
                diff = opening - prev_closing
                sign = "+" if diff > 0 else ""
                flags.append(f"Opening Mismatch: {sign}{diff:,.0f} KES (Prev: {prev_closing:,.0f}, Opened: {opening:,.0f})")

            # Check 2: Math Discrepancy
            math_discrepancy = False
            if abs(recorded_amount - calc_collections) > 0.01 and (closing > 0 or transfers > 0):
                math_discrepancy = True
                diff = recorded_amount - calc_collections
                flags.append(f"Arithmetic Discrepancy: {diff:,.0f} KES diff")

            # Check 3: Negative Collections
            if recorded_amount < 0 and row.shift_status in ("Closed", "Ended"):
                flags.append("Negative Collections Input")

            # Check 4: Unverified Transfer
            if transfers > 0 and (row.audit_status or "Pending") != "Verified":
                flags.append(f"Unverified Sweep: {transfers:,.0f} KES")

            is_discrepancy = len(flags) > 0
            if is_discrepancy:
                total_discrepancies += 1

            status = row.audit_status or ("Verified" if not is_discrepancy and row.shift_status == "Closed" and not transfers else "Pending")
            if status == "Verified":
                total_verified += 1
            elif status != "Flagged":
                total_pending += 1

            math_diff = (recorded_amount - calc_collections) if math_discrepancy else 0.0

            row["row_name"] = row.name
            row["shift"] = row.shift_id
            row["till_name"] = row.mpesa_till
            row["cashier_name"] = row.csa_name
            row["collections"] = recorded_amount
            row["transfers_out"] = transfers
            row["math_status"] = "Discrepancy" if math_discrepancy else "OK"
            row["math_discrepancy"] = math_diff
            row["carryover_status"] = "Mismatch" if carryover_mismatch else ("Match" if prev_closing is not None else "Initial")
            row["expected_opening"] = prev_closing if prev_closing is not None else opening
            row["is_flagged"] = is_discrepancy
            row["carryover_mismatch"] = carryover_mismatch
            row["audit_flags"] = flags
            row["is_discrepancy"] = is_discrepancy
            row["calculated_closing"] = expected_closing
            row["status_display"] = "Flagged" if is_discrepancy else (row.audit_status or "Pending")
            row["shift_date_formatted"] = formatdate(row.shift_date)

            audited_shifts.append(row)
            if closing > 0:
                prev_closing = closing
            elif opening > 0:
                prev_closing = opening

    # Sort audited shifts newest first for display
    audited_shifts.sort(key=lambda x: (str(x.shift_date), str(x.name)), reverse=True)

    # 3. Fetch Transfers & Sweeps Routing (from SCT and Shifts)
    sct_conditions = ["docstatus < 2", "date >= %s", "date <= %s"]
    sct_params = [from_date, to_date]
    if station and station not in ("ALL", "All Stations", ""):
        sct_conditions.append("(station = %s OR station IS NULL OR station = '')")
        sct_params.append(station)

    sct_where = " AND ".join(sct_conditions)
    sct_rows = frappe.db.sql(f"""
        SELECT 
            name, date, transaction_number, source_account, destination_account, amount, entered_by, station,
            audit_status, audit_note
        FROM `tabStation Cash Transfer`
        WHERE {sct_where} AND (
            source_account LIKE '%%MPESA%%' OR source_account LIKE '%%TILL%%' OR
            destination_account LIKE '%%MPESA%%' OR destination_account LIKE '%%TILL%%'
        )
        ORDER BY date DESC, creation DESC
    """, sct_params, as_dict=True)

    shift_transfers = []
    for r in shift_rows:
        if flt(r.transfers_made) > 0:
            dest = r.destination_account or r.bank_name or "Mapped Bank Account"
            shift_transfers.append({
                "type": "Shift Sweep",
                "transfer_type": "Shift Sweep",
                "transfer_id": r.name,
                "shift_id": r.shift_id,
                "shift": r.shift_id,
                "date": str(r.shift_date),
                "transfer_date": str(r.shift_date),
                "transfer_time": "",
                "date_formatted": formatdate(r.shift_date),
                "station": r.station,
                "source": r.mpesa_till,
                "source_account": r.mpesa_till,
                "destination": dest,
                "destination_account": dest,
                "ref": r.statement_ref or f"Shift {r.shift_id}",
                "slip_ref": r.statement_ref or f"Shift {r.shift_id}",
                "amount": flt(r.transfers_made),
                "entered_by": r.csa_name or "CSA",
                "audit_status": r.audit_status or "Pending",
                "audit_note": r.audit_note or ""
            })

    all_transfers = shift_transfers + [{
        "type": "Direct Transfer",
        "transfer_type": "Station Cash Transfer",
        "transfer_id": s.name,
        "shift_id": "-",
        "shift": "-",
        "date": str(s.date),
        "transfer_date": str(s.date),
        "transfer_time": "",
        "date_formatted": formatdate(s.date),
        "station": s.station or station or "Station",
        "source": s.source_account or "M-Pesa Till",
        "source_account": s.source_account or "M-Pesa Till",
        "destination": s.destination_account,
        "destination_account": s.destination_account,
        "ref": s.transaction_number,
        "slip_ref": s.transaction_number,
        "amount": flt(s.amount),
        "entered_by": s.entered_by or "Manager",
        "audit_status": s.audit_status or "Pending",
        "audit_note": s.audit_note or ""
    } for s in sct_rows]

    all_transfers.sort(key=lambda x: str(x["date"]), reverse=True)

    # 4. Live Tills Balance summary
    live_tills = frappe.db.sql("""
        SELECT name, till_name, till_number, station, default_account, bank_account
        FROM `tabM-Pesa Till`
        WHERE is_active = 1
        ORDER BY station ASC, till_name ASC
    """, as_dict=True)

    tills_balance_list = []
    total_live_balance = 0.0
    for t in live_tills:
        if station and station not in ("ALL", "All Stations", "") and t.station != station:
            continue
        latest = frappe.db.sql("""
            SELECT mp.closing_balance, mp.opening_balance, s.shift_date, s.status
            FROM `tabShift M-Pesa Payment` mp
            JOIN `tabShift` s ON s.name = mp.parent
            WHERE mp.mpesa_till = %s AND s.docstatus < 2
            ORDER BY s.shift_date DESC, s.creation DESC
            LIMIT 1
        """, (t.name,), as_dict=True)

        bal = 0.0
        ld = None
        if latest:
            l = latest[0]
            ld = l.shift_date
            bal = flt(l.closing_balance) if (l.status == "Closed" or flt(l.closing_balance) > 0) else flt(l.opening_balance)

        total_live_balance += bal
        tills_balance_list.append({
            "till": t.name,
            "till_name": t.till_name,
            "station": t.station,
            "balance": bal,
            "current_balance": bal,
            "last_date": str(ld) if ld else "",
            "account": t.default_account or "",
            "bank_account": t.bank_account or ""
        })

    # Apply status filter if provided
    if status_filter in ("discrepancies", "flagged"):
        audited_shifts = [r for r in audited_shifts if r.get("is_flagged")]
    elif status_filter in ("verified", "Verified"):
        audited_shifts = [r for r in audited_shifts if r.get("audit_status") == "Verified"]
    elif status_filter in ("pending", "Pending"):
        audited_shifts = [r for r in audited_shifts if r.get("audit_status") != "Verified"]

    return {
        "summary": {
            "live_balance": total_live_balance,
            "total_collections": total_collections,
            "total_transfers": total_transfers,
            "net_movement": total_collections - total_transfers,
            "flagged_count": total_discrepancies,
            "verified_count": total_verified,
            "pending_count": total_pending,
            "total_shifts_count": len(shift_rows),
            "total_transfers_count": len(all_transfers)
        },
        "kpis": {
            "live_balance": total_live_balance,
            "total_collections": total_collections,
            "total_transfers": total_transfers,
            "net_movement": total_collections - total_transfers,
            "discrepancies_count": total_discrepancies,
            "verified_count": total_verified,
            "pending_count": total_pending,
            "total_records": len(shift_rows)
        },
        "shifts": audited_shifts,
        "transfers": all_transfers,
        "tills_list": live_tills,
        "live_tills": tills_balance_list,
        "tills": tills_balance_list,
        "from_date": from_date,
        "to_date": to_date,
        "station": station or "All Stations"
    }


@frappe.whitelist()
def verify_mpesa_shift_reading(row_name, status="Verified", statement_ref=None, audit_note=None):
    """Marks a shift M-Pesa reading as Verified or Flagged with audit note."""
    if not row_name:
        frappe.throw("Reading ID is required.")

    update_dict = {
        "audit_status": status,
        "verified_by": frappe.session.user,
        "verified_on": frappe.utils.now_datetime()
    }
    if statement_ref is not None:
        update_dict["statement_ref"] = statement_ref
    if audit_note is not None:
        update_dict["audit_note"] = audit_note

    frappe.db.set_value("Shift M-Pesa Payment", row_name, update_dict)
    frappe.db.commit()
    return {"success": True, "status": "success", "message": f"M-Pesa reading marked as {status}."}


@frappe.whitelist()
def audit_mpesa_transfer_routing(transfer_id, transfer_type="Direct Transfer", status="Verified", audit_note=None, bank_slip_ref=None):
    """Audits and verifies an M-Pesa sweep / transfer."""
    if not transfer_id:
        frappe.throw("Transfer ID is required.")

    if transfer_type == "Shift Sweep" or frappe.db.exists("Shift M-Pesa Payment", transfer_id):
        frappe.db.set_value("Shift M-Pesa Payment", transfer_id, {
            "audit_status": status,
            "statement_ref": bank_slip_ref,
            "audit_note": audit_note,
            "verified_by": frappe.session.user,
            "verified_on": frappe.utils.now_datetime()
        })
    elif frappe.db.exists("Station Cash Transfer", transfer_id):
        frappe.db.set_value("Station Cash Transfer", transfer_id, {
            "audit_status": status,
            "audit_note": audit_note
        })
    frappe.db.commit()
    return {"success": True, "status": "success", "message": f"Transfer marked as {status}."}


@frappe.whitelist()
def submit_mpesa_statement_audit(station, till, statement_date, statement_opening, statement_inflows, statement_transfers, statement_closing, notes=None):
    """
    Performs side-by-side reconciliation between actual Safaricom Till statement figures and system records.
    """
    from frappe.utils import flt
    st_open = flt(statement_opening)
    st_in = flt(statement_inflows)
    st_out = flt(statement_transfers)
    st_close = flt(statement_closing)

    conditions = ["s.docstatus < 2", "DATE(s.shift_date) = %s"]
    params = [statement_date]
    if station and station not in ("ALL", "All Stations", ""):
        conditions.append("s.station = %s")
        params.append(station)
    if till and till not in ("ALL", "All Tills", ""):
        conditions.append("mp.mpesa_till = %s")
        params.append(till)

    where_clause = " AND ".join(conditions)
    records = frappe.db.sql(f"""
        SELECT 
            mp.name, mp.opening_balance, mp.closing_balance, mp.transfers_made, mp.amount
        FROM `tabShift M-Pesa Payment` mp
        JOIN `tabShift` s ON s.name = mp.parent
        WHERE {where_clause}
    """, params, as_dict=True)

    sys_in = sum(flt(r.amount) for r in records)
    sys_out = sum(flt(r.transfers_made) for r in records)
    sys_open = flt(records[0].opening_balance) if records else 0.0
    sys_close = flt(records[-1].closing_balance) if records else 0.0

    inflow_variance = st_in - sys_in
    transfer_variance = st_out - sys_out
    closing_variance = st_close - sys_close
    is_matched = abs(inflow_variance) < 1.0 and abs(transfer_variance) < 1.0 and abs(closing_variance) < 1.0

    if is_matched:
        for r in records:
            frappe.db.set_value("Shift M-Pesa Payment", r.name, {
                "audit_status": "Verified",
                "statement_ref": f"Stmt {statement_date}",
                "audit_note": notes or "Auto-matched with statement",
                "verified_by": frappe.session.user,
                "verified_on": frappe.utils.now_datetime()
            })
        frappe.db.commit()

    return {
        "statement_date": statement_date,
        "station": station,
        "till": till,
        "statement": {
            "opening": st_open,
            "inflows": st_in,
            "transfers": st_out,
            "closing": st_close
        },
        "system": {
            "opening": sys_open,
            "inflows": sys_in,
            "transfers": sys_out,
            "closing": sys_close
        },
        "variance": {
            "inflow_diff": inflow_variance,
            "transfer_diff": transfer_variance,
            "closing_diff": closing_variance
        },
        "is_matched": is_matched,
        "summary": "PERFECT MATCH! All collections & transfers verified against statement." if is_matched else f"DISCREPANCY DETECTED: Collections diff {inflow_variance:,.2f} KES, Transfers diff {transfer_variance:,.2f} KES."
    }






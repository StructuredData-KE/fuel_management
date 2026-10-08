import frappe
from frappe.model.document import Document
from frappe.utils import flt, cint, cstr, getdate, nowdate, nowtime, add_days

class Shift(Document):
    def validate(self):
        self.auto_set_shift_display()
        self.validate_future_date()
        self.lock_shift_if_closed_for_csa()
        self.lock_active_shift_overlap()
        self.auto_fetch_opening_readings()
        self.calculate_sales_quantity()
        self.calculate_expected_stock()
        self.calculate_expected_cash()
        self.auto_inject_greasing_sales_from_invoices()
        self.calculate_greasing()
        self.auto_inject_dry_stock_from_invoices()
        self.assign_inventory_sales_entry_numbers()
        self.validate_csa_reconciliation()
        self.validate_report_sent()

    def auto_inject_greasing_sales_from_invoices(self):
        from frappe.utils import flt, cint
        
        # Clean up ALL injected greasing sales first to prevent duplicates or ghost items on edit
        if getattr(self, "greasing_sales", None):
            self.greasing_sales = [
                row for row in self.greasing_sales
                if not cint(getattr(row, "is_invoice_sale", 0)) and not (isinstance(row, dict) and cint(row.get("is_invoice_sale", 0)))
            ]
            
        if not self.invoices:
            return

        # Fetch Grease Vehicle Types to map vehicle_type
        vt_map = {}
        if frappe.db.exists("DocType", "Grease Vehicle Type"):
            all_vt = frappe.get_all("Grease Vehicle Type", fields=["name", "vehicle_type", "greasing_price"])
            for vt in all_vt:
                vt_map[vt.name.upper()] = vt.name
                if vt.vehicle_type:
                    vt_map[vt.vehicle_type.upper()] = vt.name

        for inv in self.invoices:
            if not inv.item: continue
            
            item_group = frappe.db.get_value("Item", inv.item, "item_group")
            is_greasing = False
            if item_group and "GREAS" in item_group.upper():
                is_greasing = True
            elif inv.item.startswith("Greasing - ") or "GREASING" in inv.item.upper() or "GREASE" in inv.item.upper():
                is_greasing = True

            if not is_greasing:
                continue
                
            raw_name = inv.item
            if raw_name.startswith("Greasing - "):
                raw_type = raw_name.replace("Greasing - ", "").strip()
            else:
                raw_type = raw_name.strip()
                
            target_vt = vt_map.get(raw_type.upper(), None)
            if not target_vt:
                for k, v in vt_map.items():
                    if k in raw_type.upper() or raw_type.upper() in k:
                        target_vt = v
                        break
            if not target_vt:
                target_vt = raw_type
                
            qty = flt(inv.quantity) or 1.0
            rate = flt(inv.rate)
            gross_val = flt(inv.gross_amount) if getattr(inv, "gross_amount", None) else (qty * rate)
            if not gross_val and inv.amount:
                gross_val = flt(inv.amount)
            if not rate and qty:
                rate = gross_val / qty

            self.append("greasing_sales", {
                "csa": inv.csa,
                "vehicle_type": target_vt,
                "number_of_vehicles": cint(qty) if qty == int(qty) else qty,
                "amount_per_vehicle": rate,
                "total_amount": gross_val,
                "is_invoice_sale": 1,
                "reference_invoice": getattr(inv, "entry_number", None) or getattr(inv, "name", "")
            })

    def calculate_greasing(self):
        from frappe.utils import flt
        op = flt(self.grease_opening_balance)
        top = flt(self.grease_top_up)
        cl = flt(self.grease_closing_balance)
        self.grease_used = max(0.0, flt(op + top - cl, 2))
        
        total_grease = 0.0
        if self.greasing_sales:
            for row in self.greasing_sales:
                row.total_amount = flt(flt(row.number_of_vehicles) * flt(row.amount_per_vehicle), 2)
                total_grease += row.total_amount
        self.total_greasing_sales = flt(total_grease, 2)

    def calculate_sales_quantity(self):
        from frappe.utils import flt
        if self.pump_meter_readings:
            for row in self.pump_meter_readings:
                if row.closing_electronic_meter is not None and row.opening_electronic_meter is not None:
                    row.sales_quantity_electronic = max(0, flt(row.closing_electronic_meter) - flt(row.opening_electronic_meter))
                if row.closing_manual_meter is not None and row.opening_manual_meter is not None:
                    row.sales_quantity_manual = max(0, flt(row.closing_manual_meter) - flt(row.opening_manual_meter))

    def auto_inject_dry_stock_from_invoices(self):
        from frappe.utils import flt
        
        # Map existing entry numbers of injected rows to preserve them on re-save
        existing_entry_map = {}
        if getattr(self, "inventory_sales", None):
            for row in self.inventory_sales:
                ref = getattr(row, "reference_invoice", None) or (row.get("reference_invoice") if isinstance(row, dict) else None)
                enum = getattr(row, "entry_number", None) or (row.get("entry_number") if isinstance(row, dict) else None)
                if ref and enum:
                    existing_entry_map[ref] = enum

        # Clean up ALL injected inventory sales first to prevent duplicates or ghost items on edit
        if getattr(self, "inventory_sales", None):
            self.inventory_sales = [
                row for row in self.inventory_sales 
                if not (getattr(row, "is_invoice_sale", 0) if not isinstance(row, dict) else row.get("is_invoice_sale"))
            ]
            
        if not self.invoices:
            return
            
        for inv in self.invoices:
            if not inv.item: continue
            
            item_group = frappe.db.get_value("Item", inv.item, "item_group")
            if item_group and (item_group.upper() in ["FUEL", "FUELS", "GREASING SERVICES", "GREASING SERVICE"] or "GREAS" in item_group.upper()):
                continue
            if inv.item.startswith("Greasing - ") or "GREASING" in inv.item.upper():
                continue
                
            gross_val = flt(inv.gross_amount) if getattr(inv, "gross_amount", None) else (flt(inv.quantity) * flt(inv.rate))
            if not gross_val and inv.amount:
                gross_val = flt(inv.amount)

            self.append("inventory_sales", {
                "item": inv.item,
                "quantity": flt(inv.quantity),
                "selling_price": flt(inv.rate),
                "amount": gross_val,
                "sold_by": getattr(inv, "inventory_csa", inv.csa) or getattr(inv, "csa", ""),
                "is_invoice_sale": 1,
                "reference_invoice": inv.entry_number,
                "entry_number": existing_entry_map.get(inv.entry_number)
            })

    def assign_inventory_sales_entry_numbers(self):
        from frappe.utils import cint
        max_entry = frappe.db.sql("""
            SELECT MAX(entry_number) 
            FROM `tabShift Inventory Sale`
        """)[0][0]
        current_max = cint(max_entry) if max_entry else 1000
        
        # Consider any already assigned numbers in self.inventory_sales
        for row in (self.inventory_sales or []):
            num = getattr(row, "entry_number", None) or (row.get("entry_number") if isinstance(row, dict) else None)
            if num:
                current_max = max(current_max, cint(num))
                
        # Assign next sequential entry_number to rows that don't have one
        for row in (self.inventory_sales or []):
            num = getattr(row, "entry_number", None) or (row.get("entry_number") if isinstance(row, dict) else None)
            if not num:
                current_max += 1
                if isinstance(row, dict):
                    row["entry_number"] = current_max
                else:
                    row.entry_number = current_max

    def auto_set_shift_display(self):
        from frappe.utils import getdate
        if self.shift_date and self.shift_template:
            day_name = getdate(self.shift_date).strftime('%A')
            self.shift_name_display = f"{day_name} {self.shift_template}"

    def validate_future_date(self):
        from frappe.utils import getdate, today
        if getdate(self.shift_date) > getdate(today()):
            frappe.throw("Shift Date cannot be in the future.")

    def lock_active_shift_overlap(self):
        if self.is_new():
            active_shift = frappe.db.get_value("Shift", {"station": self.station, "status": "Open", "name": ("!=", self.name)}, "name")
            if active_shift:
                frappe.throw(f"Cannot start a new shift. Shift {active_shift} is currently active for this station.")

    def calculate_expected_cash(self):
        from frappe.utils import flt
        total_fuel_amount = 0.0
        
        if self.pump_meter_readings:
            for row in self.pump_meter_readings:
                if row.sales_quantity_electronic and row.sales_quantity_electronic > 0 and row.pump_nozzle:
                    tank = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                    if tank:
                        item_code = frappe.db.get_value("Fuel Tank", tank, "fuel_product")
                        if item_code:
                            # Pricing Engine: Fetch historical price where Valid From <= Shift Date
                            price_record = frappe.get_all("Item Price", 
                                filters={"item_code": item_code, "price_list": "Standard Selling", "valid_from": ("<=", self.shift_date)},
                                fields=["price_list_rate"],
                                order_by="valid_from desc",
                                limit=1
                            )
                            price = price_record[0].price_list_rate if price_record else 0.0
                            total_fuel_amount += (row.sales_quantity_electronic * price)

        total_dry_stock_amount = sum(flt(row.amount) for row in (self.inventory_sales or []))
        self.expected_dry_stock_cash = total_dry_stock_amount
        
        total_mpesa = 0.0
        if self.mpesa_payments:
            for row in self.mpesa_payments:
                row.amount = flt(row.closing_balance) - flt(row.opening_balance) + flt(row.transfers_made)
                if row.amount < 0 and self.status in ["Ended", "Closed"]:
                    frappe.throw(f"Amount collected for {row.mpesa_till} cannot be negative. Please check the closing balance and transfers made.")
                total_mpesa += row.amount

        total_cards = sum(flt(row.amount) for row in (self.card_payments or []))
        if not self.is_new():
            st_cards = frappe.get_all("Station Cards", filters={"shift": self.name}, fields=["amount"])
            total_cards += sum(flt(r.amount) for r in st_cards)
        total_invoices = sum(flt(row.amount) for row in (self.invoices or []))
        total_expenses = sum(flt(row.amount) for row in (self.shift_expenses or []))
        if not self.is_new():
            pc_entries = frappe.get_all("Station Petty Cash Entry", filters={"shift": self.name}, fields=["amount"])
            total_expenses += sum(flt(r.amount) for r in pc_entries)
            st_expenses = frappe.get_all("Station Expense", filters={"shift": self.name}, fields=["amount"])
            total_expenses += sum(flt(r.amount) for r in st_expenses)
        total_procurement = sum(flt(row.amount) for row in (self.procurement or []))

        # Deduct Fleet Card CSA Drops
        total_fleet_drops = 0.0
        
        # Deduct Station Return To Tank (RTT)
        total_rtt_amount = 0.0
        if not self.is_new():
            rtt_records = frappe.get_all("Station Return To Tank", filters={"shift": self.name}, fields=["amount"])
            total_rtt_amount = sum(frappe.utils.flt(r.amount) for r in rtt_records)

        if not self.is_new():
            fleet_summaries = frappe.get_all("Fleet Card Shift Summary", filters={"shift": self.name, "docstatus": ("<", 2)}, fields=["total_csa_drops"])
            for s in fleet_summaries:
                total_fleet_drops += flt(s.total_csa_drops)

        self.expected_cash = total_fuel_amount - (total_mpesa + total_cards + total_invoices + total_expenses + total_procurement + total_fleet_drops + total_rtt_amount)

        if getattr(self, "actual_cash", None) is not None:
            self.cash_variance = flt(self.actual_cash) - flt(self.expected_cash)
            
        if getattr(self, "actual_dry_stock_cash", None) is not None:
            self.dry_stock_cash_variance = flt(self.actual_dry_stock_cash) - flt(self.expected_dry_stock_cash)

    def on_update(self):
        self.create_stock_entry_on_close()
        self.post_cash_variance_to_liability_ledger()
        self.create_revenue_accounting_on_close()
        self.create_topup_accounting_on_close()

    def create_revenue_accounting_on_close(self):
        from frappe.utils import nowdate, flt
        
        if self.status != "Closed":
            return
            
        station_doc = frappe.get_doc("Fuel Station", self.station)
        
        # Ensure all configuration fields are present
        required_accounts = {
            "shift_control_account": "Shift Control Account",
            "cash_account": "Main Cash Account",
            "fuel_sales_account": "Fuel Sales Account",
            "dry_stock_sales_account": "Dry Stock Sales Account",
            "greasing_sales_account": "Greasing Sales Account",
            "shortfall_account": "Shortfall Account",
            "overage_account": "Overage Account"
        }
        
        for fieldname, label in required_accounts.items():
            if not getattr(station_doc, fieldname):
                frappe.throw(f"Accounting Configuration Error: Please set the '{label}' in Fuel Station {self.station}.")
                
        company = frappe.defaults.get_user_default("Company")
        if not company:
            frappe.throw("No default Company found.")
            
        # Resolve VAT Control Account
        vat_control_account = getattr(station_doc, "vat_control_account", None)
        if not vat_control_account:
            vat_control_account = frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%VAT Control%"], "is_group": 0}, "name")
        if not vat_control_account:
            vat_control_account = frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%VAT%"], "is_group": 0}, "name")
        if not vat_control_account:
            vat_control_account = "VAT Control - KIL"

        # 1. Get nozzle prices to calculate fuel revenue (8% VAT)
        total_fuel_gross = 0.0
        nozzle_tanks = {}
        tank_items = {}
        item_prices = {}
        
        for row in (self.pump_meter_readings or []):
            if getattr(row, "sales_quantity_electronic", 0) > 0:
                if row.pump_nozzle not in nozzle_tanks:
                    nozzle_tanks[row.pump_nozzle] = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                tank = nozzle_tanks[row.pump_nozzle]
                if not tank: continue
                
                if tank not in tank_items:
                    tank_items[tank] = frappe.db.get_value("Fuel Tank", tank, "fuel_product")
                item = tank_items[tank]
                if not item: continue
                
                if item not in item_prices:
                    price = frappe.db.get_value("Item Price", {"item_code": item, "price_list": "Standard Selling"}, "price_list_rate")
                    if not price:
                        price = frappe.db.get_value("Item", item, "standard_rate") or 0.0
                    item_prices[item] = flt(price)
                    
                total_fuel_gross += flt(flt(row.sales_quantity_electronic) * flt(item_prices[item]), 2)
                
        total_fuel_gross = flt(total_fuel_gross, 2)
        fuel_vat_rate = 8.0
        net_fuel_revenue = flt(total_fuel_gross / (1 + (fuel_vat_rate / 100.0)), 2)
        fuel_output_vat = flt(total_fuel_gross - net_fuel_revenue, 2)

        # 2. Calculate Dry Stock Revenue (0% on Gas, 16% on Other Inventory)
        total_gas_gross = 0.0
        total_other_inventory_gross = 0.0
        
        for row in (self.inventory_sales or []):
            qty = row.total_volume if getattr(row, "total_volume", 0) else row.quantity
            rate = row.rate if getattr(row, "rate", 0) else 0.0
            amt = getattr(row, "amount", 0)
            line_gross = flt(flt(amt) if amt else (flt(qty) * flt(rate)), 2)
            
            item_info = frappe.db.get_value("Item", row.item, ["item_group", "item_name"], as_dict=True) or {}
            group = (item_info.get("item_group") or "").upper()
            name = (item_info.get("item_name") or row.item or "").upper()
            
            is_gas = "GAS" in group or "CYLINDER" in group or "GAS" in name or "CYLINDER" in name or "LPG" in name or "6KG" in name or "13KG" in name or "35KG" in name or "50KG" in name
            
            if is_gas:
                total_gas_gross += line_gross
            else:
                total_other_inventory_gross += line_gross
                
        total_gas_gross = flt(total_gas_gross, 2)
        total_other_inventory_gross = flt(total_other_inventory_gross, 2)

        # Gas: 0% VAT
        net_gas_revenue = total_gas_gross
        gas_output_vat = 0.0
        
        # Other Inventory: 16% VAT
        inventory_vat_rate = 16.0
        net_other_inventory_revenue = flt(total_other_inventory_gross / (1 + (inventory_vat_rate / 100.0)), 2)
        inventory_output_vat = flt(total_other_inventory_gross - net_other_inventory_revenue, 2)
        
        total_dry_stock_gross = flt(total_gas_gross + total_other_inventory_gross, 2)
        net_dry_stock_revenue = flt(net_gas_revenue + net_other_inventory_revenue, 2)
        total_dry_stock_vat = flt(gas_output_vat + inventory_output_vat, 2)
                
        # 3. Calculate Greasing Revenue
        total_greasing_gross = flt(getattr(self, "total_greasing_sales", 0), 2)
        net_greasing_revenue = total_greasing_gross
        greasing_output_vat = 0.0
            
        total_revenue_gross = flt(total_fuel_gross + total_dry_stock_gross + total_greasing_gross, 2)
        total_sales_output_vat = flt(fuel_output_vat + total_dry_stock_vat + greasing_output_vat, 2)
        
        # Clean up any existing duplicate Shift Closure Journal Entries to prevent double-posting
        existing_jes = frappe.get_all("Journal Entry", filters={"user_remark": f"Shift Closure Accounting for Shift {self.name}", "docstatus": ["<", 2]})
        for old_je in existing_jes:
            try:
                old_doc = frappe.get_doc("Journal Entry", old_je.name)
                if old_doc.docstatus == 1:
                    old_doc.cancel()
                frappe.delete_doc("Journal Entry", old_je.name, ignore_permissions=True)
            except Exception:
                pass

        # We will create ONE massive Journal Entry for the entire shift closure.
        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.posting_date = self.shift_date or nowdate()
        je.company = company
        je.user_remark = f"Shift Closure Accounting for Shift {self.name}"
        
        # --- REVENUE RECOGNITION (Income Generation & Output VAT) ---
        if total_revenue_gross > 0:
            je.append("accounts", {
                "account": station_doc.shift_control_account,
                "debit_in_account_currency": total_revenue_gross,
                "user_remark": "Total Shift Revenue Expected (Gross Inclusive of VAT)"
            })
            if net_fuel_revenue > 0:
                je.append("accounts", {
                    "account": station_doc.fuel_sales_account,
                    "credit_in_account_currency": net_fuel_revenue,
                    "user_remark": f"Net Fuel Sales (Excl. 8% VAT: {fuel_output_vat:.2f})"
                })
            if net_dry_stock_revenue > 0:
                je.append("accounts", {
                    "account": station_doc.dry_stock_sales_account,
                    "credit_in_account_currency": net_dry_stock_revenue,
                    "user_remark": f"Net Dry Stock Sales (Gas 0%: {total_gas_gross:.2f}, Other 16% VAT: {inventory_output_vat:.2f})"
                })
            if net_greasing_revenue > 0:
                je.append("accounts", {
                    "account": station_doc.greasing_sales_account,
                    "credit_in_account_currency": net_greasing_revenue,
                    "user_remark": "Total Greasing Sales"
                })
            if total_sales_output_vat > 0 and vat_control_account:
                je.append("accounts", {
                    "account": vat_control_account,
                    "credit_in_account_currency": total_sales_output_vat,
                    "user_remark": f"Shift Output VAT (Fuel 8%: {fuel_output_vat:.2f}, Inventory 16%: {inventory_output_vat:.2f})"
                })
                
        # --- PAYMENT ALLOCATIONS (Clearing the Control Account) ---
        
        # A. CSA Cash (Includes Cash from Sales AND Cash from Customer Payments)
        recons = frappe.get_all("Shift Cash Reconciliation", filters={"shift": self.name}, fields=["csa", "actual_cash", "variance"])
        for r in recons:
            tot_cash = flt(r.actual_cash, 2)
            if tot_cash > 0:
                csa_name = frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa
                
                # Debit Main Cash
                je.append("accounts", {
                    "account": station_doc.cash_account,
                    "debit_in_account_currency": tot_cash,
                    "user_remark": f"Cash Submitted by {csa_name}"
                })
                
                cash_for_sales = tot_cash
                
                # Credit Shift Control (for the Sales portion)
                if cash_for_sales > 0:
                    je.append("accounts", {
                        "account": station_doc.shift_control_account,
                        "credit_in_account_currency": cash_for_sales,
                        "user_remark": f"Clear Cash Sales from {csa_name}"
                    })
                elif cash_for_sales < 0:
                    je.append("accounts", {
                        "account": station_doc.shift_control_account,
                        "debit_in_account_currency": abs(cash_for_sales),
                        "user_remark": f"Adjustment for Sales from {csa_name}"
                    })
                
            # Variances
            var = flt(r.variance, 2)
            if var < 0:
                shortfall = abs(var)
                csa_name = frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa
                je.append("accounts", {
                    "account": station_doc.shortfall_account,
                    "party_type": "Employee",
                    "party": r.csa,
                    "debit_in_account_currency": shortfall,
                    "user_remark": f"Shortfall for {csa_name}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": shortfall,
                    "user_remark": f"Clear Shortfall for {csa_name}"
                })
            elif var > 0:
                # Overage / Excess: Credit to CSA's Shortfall / Staff Clearing Account
                excess = var
                csa_name = frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "debit_in_account_currency": excess,
                    "user_remark": f"Clear Excess for {csa_name}"
                })
                je.append("accounts", {
                    "account": station_doc.shortfall_account,
                    "party_type": "Employee",
                    "party": r.csa,
                    "credit_in_account_currency": excess,
                    "user_remark": f"Excess Credit for {csa_name}"
                })
                
        # A2. Dry Stock Cash
        dry_cash = flt(self.actual_dry_stock_cash, 2)
        if dry_cash > 0:
            je.append("accounts", {
                "account": station_doc.cash_account,
                "debit_in_account_currency": dry_cash,
                "user_remark": "Dry Stock Cash Submitted"
            })
            je.append("accounts", {
                "account": station_doc.shift_control_account,
                "credit_in_account_currency": dry_cash,
                "user_remark": "Clear Dry Stock Cash Sales"
            })


        # B. Invoices & Discounts
        for inv in (self.invoices or []):
            net_amt = flt(inv.amount, 2)
            disc_amt = flt(getattr(inv, "discount_amount", 0), 2)
            if net_amt > 0:
                ar_account = frappe.db.get_value("Party Account", {"parent": inv.customer, "parenttype": "Customer", "company": company}, "account") or frappe.db.get_value("Company", company, "default_receivable_account")
                if not ar_account:
                    frappe.throw(f"No AR account found for customer {inv.customer}")
                je.append("accounts", {
                    "account": ar_account,
                    "party_type": "Customer",
                    "party": inv.customer,
                    "debit_in_account_currency": net_amt,
                    "user_remark": f"Credit Sale (Invoice {inv.entry_number or ''})"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": net_amt,
                    "user_remark": f"Clear Invoice for {inv.customer}"
                })
            if disc_amt > 0:
                discount_account = getattr(station_doc, "discount_account", None)
                if not discount_account:
                    discount_account = frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%Discount%"], "is_group": 0}, "name")
                if not discount_account:
                    discount_account = frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%Sales Expense%"], "is_group": 0}, "name")
                if not discount_account:
                    discount_account = "Discounts Allowed - KIL"
                
                acc_type = frappe.db.get_value("Account", discount_account, "account_type")
                disc_row = {
                    "account": discount_account,
                    "debit_in_account_currency": disc_amt,
                    "user_remark": f"Discount Allowed on Invoice {inv.entry_number or ''} ({inv.customer})"
                }
                if acc_type in ["Receivable", "Payable"]:
                    if getattr(inv, "discount_csa", None):
                        disc_row["party_type"] = "Employee"
                        disc_row["party"] = inv.discount_csa
                    else:
                        disc_row["party_type"] = "Customer"
                        disc_row["party"] = inv.customer
                
                je.append("accounts", disc_row)
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": disc_amt,
                    "user_remark": f"Clear Discount for {inv.customer}"
                })
                
        # C. M-Pesa
        for m in (self.mpesa_payments or []):
            if not m.mpesa_till: continue
            till_doc = frappe.get_doc("M-Pesa Till", m.mpesa_till)
            mop_account = till_doc.default_account
            bank_account = getattr(till_doc, "bank_account", None)

            m_amt = flt(m.amount, 2)
            m_transfers = flt(m.transfers_made, 2)

            if m_amt > 0:
                if not mop_account:
                    frappe.throw(f"No Default Account mapped for M-Pesa Till: {m.mpesa_till}")
                je.append("accounts", {
                    "account": mop_account,
                    "debit_in_account_currency": m_amt,
                    "user_remark": f"M-Pesa Payment ({m.mpesa_till})"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": m_amt,
                    "user_remark": f"Clear M-Pesa"
                })
                
            if m_transfers > 0:
                if not bank_account:
                    frappe.throw(f"No Bank Account mapped for Transfers on M-Pesa Till: {m.mpesa_till}. Please configure the Bank Account in the Till settings.")
                if not mop_account:
                    frappe.throw(f"No Default Account mapped for M-Pesa Till: {m.mpesa_till}")
                    
                je.append("accounts", {
                    "account": bank_account,
                    "debit_in_account_currency": m_transfers,
                    "user_remark": f"Bank Transfer from {m.mpesa_till}"
                })
                je.append("accounts", {
                    "account": mop_account,
                    "credit_in_account_currency": m_transfers,
                    "user_remark": f"Bank Transfer Out"
                })
                
        # D. Cards (from self.card_payments and tabStation Cards)
        processed_cards = []
        for c in (self.card_payments or []):
            processed_cards.append({
                "amount": flt(c.amount, 2),
                "card": getattr(c, "card", getattr(c, "mode_of_payment", "Card")),
                "source": "Shift Card Payment"
            })
            
        if not self.is_new():
            st_cards = frappe.get_all("Station Cards", filters={"shift": self.name}, fields=["amount", "card", "receipt_no"])
            for sc in st_cards:
                processed_cards.append({
                    "amount": flt(sc.amount, 2),
                    "card": sc.card,
                    "source": f"Station Card ({sc.card} - {sc.receipt_no})"
                })
                
        for c in processed_cards:
            c_amt = flt(c.get("amount"), 2)
            if c_amt > 0:
                card_name = c.get("card")
                mop_account = None
                
                # 1. Check if Station Card Type has default_account set directly
                if card_name and frappe.db.exists("Station Card Type", card_name):
                    mop_account = frappe.db.get_value("Station Card Type", card_name, "default_account")
                    
                # 2. Check Mode of Payment Account for specific card name
                if not mop_account and card_name:
                    mop_account = frappe.db.get_value("Mode of Payment Account", {"parent": card_name, "company": company}, "default_account")
                    
                # 3. Fallback to Mode of Payment Account for 'Card'
                if not mop_account:
                    mop_account = frappe.db.get_value("Mode of Payment Account", {"parent": "Card", "company": company}, "default_account")
                    
                if not mop_account:
                    frappe.throw(f"No Default Account mapped for Card '{card_name or 'Card'}'. Please configure the Default Account in Station Card Type '{card_name}' or Mode of Payment 'Card'.")
                    
                je.append("accounts", {
                    "account": mop_account,
                    "debit_in_account_currency": c_amt,
                    "user_remark": f"Card Payment: {c.get('source')}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": c_amt,
                    "user_remark": f"Clear Card: {c.get('source')}"
                })
                
        # E. Petty Cash & Station Expenses
        # 1. Station Petty Cash Entries
        petty_cash_entries = frappe.get_all(
            "Station Petty Cash Entry",
            filters={"shift": self.name},
            fields=["name", "amount", "expense_account", "category", "payee", "memo", "csa"]
        )
        for pc in petty_cash_entries:
            pc_amt = flt(pc.amount, 2)
            if pc_amt > 0:
                exp_acc = pc.expense_account
                if not exp_acc:
                    exp_acc = getattr(station_doc, "miscellaneous_expenses_account", None) or frappe.db.get_value("Account", {"company": company, "account_name": ["like", "%Miscellaneous%"], "is_group": 0}, "name")
                if not exp_acc:
                    exp_acc = "Miscellaneous Expenses - KIL"
                
                csa_name = frappe.db.get_value("Employee", pc.csa, "employee_name") or pc.csa or "Station"
                memo_str = f": {pc.memo}" if pc.memo else ""
                payee_str = f" (Payee: {pc.payee})" if pc.payee else ""
                je.append("accounts", {
                    "account": exp_acc,
                    "debit_in_account_currency": pc_amt,
                    "user_remark": f"Petty Cash ({pc.category or 'Expense'}{memo_str}) - Paid by {csa_name}{payee_str}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": pc_amt,
                    "user_remark": f"Clear Petty Cash: {pc.name}"
                })

        # 2. Legacy Shift Expenses
        for e in (self.shift_expenses or []):
            e_amt = flt(e.amount, 2)
            if e_amt > 0:
                je.append("accounts", {
                    "account": e.expense_account,
                    "debit_in_account_currency": e_amt,
                    "user_remark": f"Shift Expense: {e.description}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": e_amt,
                    "user_remark": f"Clear Expense"
                })
                
        # F. Return to Tank (RTT)
        for rtt in frappe.get_all("Station Return To Tank", filters={"shift": self.name}, fields=["item", "volume_returned"]):
            if flt(rtt.volume_returned) > 0:
                price_rec = frappe.get_all("Item Price", filters={"item_code": rtt.item, "price_list": "Standard Selling", "valid_from": ("<=", self.shift_date)}, fields=["price_list_rate"], order_by="valid_from desc", limit=1)
                price = flt(price_rec[0].price_list_rate) if price_rec else 0.0
                rtt_gross = flt(flt(rtt.volume_returned) * flt(price), 2)
                if rtt_gross > 0:
                    rtt_net = flt(rtt_gross / 1.08, 2)
                    rtt_vat = flt(rtt_gross - rtt_net, 2)
                    je.append("accounts", {
                        "account": station_doc.fuel_sales_account,
                        "debit_in_account_currency": rtt_net,
                        "user_remark": f"Reverse RTT Net Revenue: {rtt.volume_returned}L"
                    })
                    if rtt_vat > 0 and vat_control_account:
                        je.append("accounts", {
                            "account": vat_control_account,
                            "debit_in_account_currency": rtt_vat,
                            "user_remark": f"Reverse RTT Output VAT: {rtt.volume_returned}L"
                        })
                    je.append("accounts", {
                        "account": station_doc.shift_control_account,
                        "credit_in_account_currency": rtt_gross,
                        "user_remark": f"Clear RTT: {rtt.volume_returned}L"
                    })
                
        # G. Non-Cash Customer Payments
        customer_payments = frappe.get_all("Customer Payment", filters={"shift": self.name, "docstatus": 1})
        for cp in customer_payments:
            cp_doc = frappe.get_doc("Customer Payment", cp.name)
            cp_amt = flt(cp_doc.amount, 2)
            if cp_doc.mode_of_payment != "Cash" and cp_amt > 0:
                mop_account = frappe.db.get_value("Mode of Payment Account", {"parent": cp_doc.mode_of_payment, "company": company}, "default_account")
                if not mop_account:
                    frappe.throw(f"No Default Account mapped for Mode of Payment: {cp_doc.mode_of_payment} (Customer Payment {cp_doc.name})")
                je.append("accounts", {
                    "account": mop_account,
                    "debit_in_account_currency": cp_amt,
                    "user_remark": f"Clear Non-Cash Customer Payment via {cp_doc.mode_of_payment}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": cp_amt,
                    "user_remark": f"Clear Customer Payment for {cp_doc.customer}"
                })

        if len(je.accounts) > 0:
            # Check for any rounding fractional differences and balance on shift control account
            tot_dr = sum(flt(d.get("debit_in_account_currency", 0), 2) for d in je.accounts)
            tot_cr = sum(flt(d.get("credit_in_account_currency", 0), 2) for d in je.accounts)
            diff = flt(tot_dr - tot_cr, 2)
            if abs(diff) > 0 and abs(diff) <= 0.50:
                for acc in je.accounts:
                    if acc.account == station_doc.shift_control_account:
                        if diff > 0 and flt(acc.credit_in_account_currency, 2) > 0:
                            acc.credit_in_account_currency = flt(acc.credit_in_account_currency + diff, 2)
                            break
                        elif diff < 0 and flt(acc.debit_in_account_currency, 2) > 0:
                            acc.debit_in_account_currency = flt(acc.debit_in_account_currency + abs(diff), 2)
                            break

            # Ensure any Receivable / Payable account has party_type and party
            for acc in je.accounts:
                a_type = frappe.db.get_value("Account", acc.account, "account_type")
                if a_type in ["Receivable", "Payable"] and not acc.party:
                    acc.party_type = "Employee"
                    if self.assigned_csas and self.assigned_csas[0].csa:
                        acc.party = self.assigned_csas[0].csa
                    else:
                        emp = frappe.get_all("Employee", limit=1)
                        acc.party = emp[0].name if emp else ""

            je.flags.ignore_permissions = True
            je.insert()
            je.submit()
            frappe.msgprint(f"Generated Shift Control Journal Entry {je.name}")

    def post_cash_variance_to_liability_ledger(self):
        if self.status != "Closed": return
        
        reconciliations = frappe.get_all(
            "Shift Cash Reconciliation", 
            filters={"shift": self.name}, 
            fields=["csa", "variance"]
        )
        
        for recon in reconciliations:
            var = flt(recon.variance)
            if var < 0:
                shortfall = abs(var)
                existing = frappe.db.exists("Staff Liability Ledger", {"shift": self.name, "employee": recon.csa, "reason": ("like", "Shift Cash Variance Shortfall%")})
                if not existing:
                    ledger = frappe.new_doc("Staff Liability Ledger")
                    ledger.employee = recon.csa
                    ledger.date = self.shift_date
                    ledger.shift = self.name
                    ledger.amount = shortfall
                    ledger.reason = f"Shift Cash Variance Shortfall for Shift {self.name}"
                    ledger.status = "Unpaid"
                    ledger.insert(ignore_permissions=True)
                    ledger.submit()
                    frappe.msgprint(f"Staff Liability Ledger created for CSA {recon.csa} for shortfall of {shortfall}")
            elif var > 0:
                excess = var
                existing = frappe.db.exists("Staff Liability Ledger", {"shift": self.name, "employee": recon.csa, "reason": ("like", "Shift Cash Variance Excess%")})
                if not existing:
                    ledger = frappe.new_doc("Staff Liability Ledger")
                    ledger.employee = recon.csa
                    ledger.date = self.shift_date
                    ledger.shift = self.name
                    ledger.amount = -excess
                    ledger.reason = f"Shift Cash Variance Excess for Shift {self.name}"
                    ledger.status = "Deducted"
                    ledger.insert(ignore_permissions=True)
                    ledger.submit()
                    frappe.msgprint(f"Staff Liability Ledger credit created for CSA {recon.csa} for excess of {excess}")

    def validate_csa_reconciliation(self):
        if self.status in ["Ended", "Closed"]:
            if self.assigned_csas:
                csas_in_shift = [row.csa for row in self.assigned_csas if row.csa]
                if not csas_in_shift:
                    return
                reconciled = frappe.get_all("Shift Cash Reconciliation", filters={"shift": self.name}, pluck="csa")
                missing = [csa for csa in csas_in_shift if csa not in reconciled]
                if missing:
                    frappe.throw(f"Cannot close shift. The following CSAs have not been reconciled: {', '.join(missing)}")

    def validate_report_sent(self):
        if self.status == "Closed" and not self.report_sent:
            frappe.throw("You must send the End Shift Report to the owner before closing the shift.")

    def lock_shift_if_closed_for_csa(self):
        if not self.is_new():
            old_status = frappe.db.get_value("Shift", self.name, "status")
            if old_status == "Closed":
                if "System Manager" not in frappe.get_roles(frappe.session.user):
                    frappe.throw("Closed Shifts cannot be modified. Please contact an Administrator.")

    def auto_fetch_opening_readings(self):
        last_shift_doc = None
        station_opening = None
        if self.station:
            # Strictly find the chronologically previous shift
            query = """
                SELECT name FROM `tabShift`
                WHERE station = %s AND name != %s
                AND (shift_date < %s OR (shift_date = %s AND start_time < %s))
                ORDER BY shift_date DESC, start_time DESC, creation DESC
                LIMIT 1
            """
            # If start_time is None, treat it as early morning "00:00:00"
            s_time = self.start_time or "00:00:00"
            last_shift = frappe.db.sql(query, (self.station, self.name, self.shift_date, self.shift_date, s_time), as_dict=True)
            
            if last_shift:
                last_shift_doc = frappe.get_doc("Shift", last_shift[0].name)
            else:
                # Fallback: maybe there is a shift on the same date with no start_time, created before this one
                fallback = frappe.db.sql("""
                    SELECT name FROM `tabShift`
                    WHERE station = %s AND name != %s AND shift_date <= %s
                    ORDER BY shift_date DESC, creation DESC
                    LIMIT 1
                """, (self.station, self.name, self.shift_date), as_dict=True)
                if fallback:
                    last_shift_doc = frappe.get_doc("Shift", fallback[0].name)
                
            sob = frappe.get_all("Station Opening Balance", filters={"station": self.station, "docstatus": 1}, order_by="date desc, creation desc", limit=1)
            if sob:
                station_opening = frappe.get_doc("Station Opening Balance", sob[0].name)

        if self.station:
            pump_groups = frappe.get_all("Pump Group", filters={"station": self.station}, pluck="name")
            nozzles = frappe.get_all("Pump Nozzle", filters={"pump_group": ["in", pump_groups]}, fields=["name"]) if pump_groups else []
            existing_nozzles = [r.pump_nozzle for r in (self.pump_meter_readings or [])]
            
            for nozzle in nozzles:
                if nozzle.name in existing_nozzles:
                    continue
                opening_elec = 0
                opening_manual = 0
                found = False
                if last_shift_doc:
                    for row in last_shift_doc.pump_meter_readings:
                        if row.pump_nozzle == nozzle.name:
                            opening_elec = row.closing_electronic_meter
                            opening_manual = row.closing_manual_meter
                            found = True
                            break
                            
                if not found and station_opening:
                    for row in station_opening.nozzle_balances:
                        if getattr(row, "pump_nozzle", None) == nozzle.name:
                            opening_elec = row.opening_electronic_meter
                            opening_manual = row.opening_manual_meter
                            break
                            
                self.append("pump_meter_readings", {
                    "pump_nozzle": nozzle.name,
                    "opening_electronic_meter": opening_elec,
                    "opening_manual_meter": opening_manual
                })
        elif self.pump_meter_readings and self.station and self.status == "Open":
            for row in self.pump_meter_readings:
                found = False
                if last_shift_doc:
                    for prev_row in last_shift_doc.pump_meter_readings:
                        if prev_row.pump_nozzle == row.pump_nozzle:
                            # Only overwrite if we found a valid number, otherwise keep what's there
                            if prev_row.closing_electronic_meter is not None:
                                row.opening_electronic_meter = prev_row.closing_electronic_meter
                            if prev_row.closing_manual_meter is not None:
                                row.opening_manual_meter = prev_row.closing_manual_meter
                            found = True
                            break
                if not found and station_opening:
                    for prev_row in station_opening.nozzle_balances:
                        if getattr(prev_row, "pump_nozzle", None) == row.pump_nozzle:
                            row.opening_electronic_meter = prev_row.opening_electronic_meter
                            row.opening_manual_meter = prev_row.opening_manual_meter
                            break

        if self.station:
            tanks = frappe.get_all("Fuel Tank", filters={"station": self.station}, fields=["name"], order_by="name ASC")
            existing_tanks = [r.fuel_tank for r in (self.dip_stick_readings or [])]
            for tank in tanks:
                if tank.name in existing_tanks:
                    continue
                opening_dip = 0.0
                found = False
                
                last_dip = frappe.db.sql("""
                    SELECT r.closing_dip
                    FROM `tabDip Stick Reading` r
                    JOIN `tabShift` s ON r.parent = s.name
                    WHERE s.station = %s AND r.fuel_tank = %s AND r.closing_dip > 0 AND s.name != %s
                    ORDER BY s.creation DESC
                    LIMIT 1
                """, (self.station, tank.name, self.name))

                if last_dip and last_dip[0][0]:
                    opening_dip = last_dip[0][0]
                    found = True
                            
                if not found and station_opening:
                    for row in (station_opening.get("dip_balances") or []):
                        if getattr(row, "fuel_tank", None) == tank.name:
                            opening_dip = row.opening_dip or 0.0
                            break
                            
                self.append("dip_stick_readings", {
                    "fuel_tank": tank.name,
                    "opening_dip": opening_dip
                })
        elif self.dip_stick_readings and self.station and self.status == "Open":
            for row in self.dip_stick_readings:
                found = False
                
                last_dip = frappe.db.sql("""
                    SELECT r.closing_dip
                    FROM `tabDip Stick Reading` r
                    JOIN `tabShift` s ON r.parent = s.name
                    WHERE s.station = %s AND r.fuel_tank = %s AND r.closing_dip > 0 AND s.name != %s
                    ORDER BY s.creation DESC
                    LIMIT 1
                """, (self.station, row.fuel_tank, self.name))

                if last_dip and last_dip[0][0]:
                    row.opening_dip = last_dip[0][0]
                    found = True

                if not found and station_opening:
                    for prev_row in (station_opening.get("dip_balances") or []):
                        if getattr(prev_row, "fuel_tank", None) == row.fuel_tank:
                            row.opening_dip = prev_row.opening_dip or 0.0
                            break

        if not self.mpesa_payments and self.station:
            tills = frappe.get_all("M-Pesa Till", filters={"station": self.station, "is_active": 1}, fields=["name"])
            for till in tills:
                opening_bal = 0
                found = False
                if last_shift_doc:
                    for row in (last_shift_doc.mpesa_payments or []):
                        if getattr(row, "mpesa_till", None) == till.name:
                            opening_bal = row.closing_balance or 0
                            found = True
                            break
                            
                if not found and station_opening:
                    for row in (station_opening.mpesa_balances or []):
                        if getattr(row, "mpesa_till", None) == till.name:
                            opening_bal = row.opening_balance or 0
                            break
                self.append("mpesa_payments", {
                    "mpesa_till": till.name,
                    "opening_balance": opening_bal,
                    "closing_balance": 0,
                    "transfers_made": 0
                })
        elif self.mpesa_payments and self.station and self.status == "Open":
            for row in self.mpesa_payments:
                found = False
                if last_shift_doc:
                    for prev_row in (last_shift_doc.mpesa_payments or []):
                        if getattr(prev_row, "mpesa_till", None) == row.mpesa_till:
                            if prev_row.closing_balance is not None:
                                row.opening_balance = prev_row.closing_balance
                            found = True
                            break
                if not found and station_opening:
                    for prev_row in (station_opening.mpesa_balances or []):
                        if getattr(prev_row, "mpesa_till", None) == row.mpesa_till:
                            row.opening_balance = prev_row.opening_balance or 0
                            break

    def calculate_expected_stock(self):
        from frappe.utils import flt
        if self.station and self.dip_stick_readings:
            # Get all purchases for this shift
            shift_purchases = frappe.get_all("Station Purchase", filters={"shift": self.name, "docstatus": 1}, pluck="name")
            purchase_map = {}
            if shift_purchases:
                items = frappe.get_all("Station Purchase Item", filters={"parent": ["in", shift_purchases]}, fields=["item_code", "qty"])
                for item in items:
                    purchase_map[item.item_code] = purchase_map.get(item.item_code, 0) + flt(item.qty)

            for row in self.dip_stick_readings:
                tank = frappe.db.get_value("Fuel Tank", row.fuel_tank, ["fuel_product"], as_dict=True)
                
                sales = 0
                if self.pump_meter_readings:
                    for p in self.pump_meter_readings:
                        if p.pump_nozzle:
                            pump_tank = frappe.db.get_value("Pump Nozzle", p.pump_nozzle, "fuel_tank")
                            if pump_tank == row.fuel_tank:
                                sales += (p.sales_quantity_electronic or 0)
                                
                purchased_qty = 0
                if tank and tank.fuel_product:
                    purchased_qty = purchase_map.get(tank.fuel_product, 0)
                    
                row.expected_stock = flt(row.opening_dip) + purchased_qty - sales

    def create_stock_entry_on_close(self):
        if self.status == "Closed" and not self.stock_entry_reference:
            station_doc = frappe.get_doc("Fuel Station", self.station)
            if not station_doc.default_forecourt_warehouse:
                frappe.throw("Cannot deduct stock: Fuel Station missing Default Forecourt Warehouse.")

            sales_per_item = {}
            
            # Deduct Fuel Meter Sales
            for row in self.pump_meter_readings:
                if getattr(row, "sales_quantity_electronic", 0) and row.sales_quantity_electronic > 0:
                    tank_name = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                    if tank_name:
                        item_code = frappe.db.get_value("Fuel Tank", tank_name, "fuel_product")
                        if item_code:
                            sales_per_item[item_code] = sales_per_item.get(item_code, 0) + row.sales_quantity_electronic

            # Deduct Dry Stock / Inventory Sales
            for row in (self.inventory_sales or []):
                if getattr(row, "item", None) and getattr(row, "quantity", 0) and row.quantity > 0:
                    # Deduct the base quantity (pieces/bottles) instead of volume
                    qty = row.quantity
                    sales_per_item[row.item] = sales_per_item.get(row.item, 0) + qty

            # Note: Credit Invoice Non-Fuel Items are already injected into inventory_sales
            # so we DO NOT iterate over self.invoices here, avoiding double-deduction!


            # Deduct Station Return To Tank Volumes (credit back to stock)
            rtt_records = frappe.get_all("Station Return To Tank", filters={"shift": self.name}, fields=["item", "volume_returned"])
            for rtt in rtt_records:
                if rtt.item and rtt.volume_returned:
                    sales_per_item[rtt.item] = sales_per_item.get(rtt.item, 0) - rtt.volume_returned

            if not sales_per_item or all(qty <= 0 for qty in sales_per_item.values()):
                return


            se = frappe.new_doc("Stock Entry")
            se.stock_entry_type = "Material Issue"
            se.purpose = "Material Issue"
            se.from_warehouse = station_doc.default_forecourt_warehouse
            se.remarks = f"Fuel Sales for Shift {self.name}"

            for item_code, qty in sales_per_item.items():
                company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
                se.append("items", {
                    "item_code": item_code,
                    "qty": qty,
                    "s_warehouse": station_doc.default_forecourt_warehouse,
                    "cost_center": frappe.get_cached_value("Company", company, "cost_center") or None,
                    "allow_zero_valuation_rate": 1
                })

            se.insert(ignore_permissions=True)
            se.submit()

            self.db_set("stock_entry_reference", se.name)
            frappe.msgprint(f"Stock Entry {se.name} automatically created to deduct fuel and inventory sales.")


    def create_topup_accounting_on_close(self):
        from frappe.utils import nowdate, flt
        
        if self.status != "Closed":
            return
            
        topups = frappe.get_all("Station Supplier Top Up", filters={"shift": self.name}, fields=["name", "card", "amount", "rrn_number", "mode_of_payment"])
        if not topups:
            return
            
        company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
        if not company:
            return
            
        default_cash_account = frappe.get_cached_value("Company", company, "default_cash_account")
        default_payable_account = frappe.get_cached_value("Company", company, "default_payable_account")
        
        # Check if Fuel Station has a Holding Account
        station_doc = frappe.get_doc("Fuel Station", self.station)
        holding_account = station_doc.get("top_up_holding_account")
        
        credit_account = holding_account or default_payable_account
        
        if not credit_account:
            frappe.msgprint("Neither Top Up Holding Account nor Default Payable account is set. Skipping Top-Up Accounting.")
            return

        # We will create one Journal Entry for all top-ups in this shift
        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = company
        je.posting_date = self.shift_date or nowdate()
        je.user_remark = f"Supplier Cash Top-Ups for Shift {self.name}"
        
        has_entries = False
        
        # Track debit amounts per account
        debit_accounts = {}
        
        for t in topups:
            amount = flt(t.amount)
            if amount <= 0: continue
            
            supplier = frappe.db.get_value("Supplier Card", t.card, "supplier")
            if not supplier: continue
            
            # Credit Account
            account_type = frappe.db.get_value("Account", credit_account, "account_type")
            credit_row = {
                "account": credit_account,
                "credit_in_account_currency": amount,
                "user_remark": f"Top-Up RRN: {t.rrn_number} (Ref: {t.name})"
            }
            if account_type == "Payable":
                credit_row["party_type"] = "Supplier"
                credit_row["party"] = supplier
                
            je.append("accounts", credit_row)
            
            # Determine Debit Account based on Mode of Payment
            debit_acct = default_cash_account
            if getattr(t, "mode_of_payment", None):
                mop_acct = frappe.db.get_value("Mode of Payment Account", {"parent": t.mode_of_payment, "company": company}, "default_account")
                if mop_acct:
                    debit_acct = mop_acct
            
            if not debit_acct:
                frappe.throw(f"No account found to Debit for Mode of Payment {t.mode_of_payment} or Default Cash Account is missing.")
                
            debit_accounts[debit_acct] = debit_accounts.get(debit_acct, 0.0) + amount
            has_entries = True
            
        if has_entries:
            # Debit Cash/MOP Accounts
            for acct, amt in debit_accounts.items():
                je.append("accounts", {
                    "account": acct,
                    "debit_in_account_currency": amt,
                    "user_remark": f"Total received for Supplier Top-Ups Shift {self.name}"
                })
            
            je.flags.ignore_permissions = True
            je.insert()
            je.submit()
            frappe.msgprint(f"Generated Journal Entry {je.name} for Supplier Cash Top-Ups.")

    def get_wet_stock_summary(self):
        from fuel_management.fuel_management.api import get_daily_dip_summary
        return get_daily_dip_summary(self.name)

    def get_pump_group_sales_summary(self):
        from frappe.utils import flt
        
        # 1. Map Assigned CSAs to Pump Groups
        csa_by_group = {}
        for ac in (self.assigned_csas or []):
            if ac.pump_group:
                emp_name = frappe.db.get_value("Employee", ac.csa, "employee_name") or ac.csa
                csa_by_group.setdefault(ac.pump_group, []).append(emp_name)

        # 2. Group Nozzle Sales by Pump Group
        group_data = {}
        st_groups = frappe.get_all("Pump Group", filters={"station": self.station}, order_by="name asc", pluck="name") if self.station else []
        for pg in st_groups:
            if "lube" not in pg.lower():
                group_data[pg] = {
                    "pump_group": pg,
                    "csas": ", ".join(csa_by_group.get(pg, [])) or "-",
                    "pms_liters": 0.0,
                    "ago_liters": 0.0,
                    "total_liters": 0.0,
                    "nozzles": []
                }

        for m in (self.pump_meter_readings or []):
            nz_info = frappe.db.get_value("Pump Nozzle", m.pump_nozzle, ["pump_group", "fuel_tank"], as_dict=True)
            tank_info = frappe.db.get_value("Fuel Tank", nz_info.fuel_tank, "fuel_product") if nz_info else ""
            prod = tank_info or (nz_info.fuel_tank if nz_info else "") or ""
            qty = max(0.0, flt(m.sales_quantity_electronic) or (flt(m.closing_electronic_meter) - flt(m.opening_electronic_meter)))
            pg = nz_info.pump_group if (nz_info and nz_info.pump_group) else "Other"

            if pg not in group_data:
                group_data[pg] = {
                    "pump_group": pg,
                    "csas": ", ".join(csa_by_group.get(pg, [])) or "-",
                    "pms_liters": 0.0,
                    "ago_liters": 0.0,
                    "total_liters": 0.0,
                    "nozzles": []
                }

            is_pms = any(k in prod.lower() for k in ['petrol', 'pms', 'super']) or 'pms' in (m.pump_nozzle or '').lower()
            if is_pms:
                group_data[pg]["pms_liters"] += qty
            else:
                group_data[pg]["ago_liters"] += qty
            group_data[pg]["total_liters"] += qty
            group_data[pg]["nozzles"].append({
                "nozzle": m.pump_nozzle,
                "product": prod,
                "opening": flt(m.opening_electronic_meter),
                "closing": flt(m.closing_electronic_meter),
                "sales_qty": qty
            })

        return [group_data[pg] for pg in sorted(group_data.keys())]

@frappe.whitelist()
def reopen_shift(shift_name):
    shift = frappe.get_doc("Shift", shift_name)
    if shift.status != "Closed": return
    
    # Cancel Stock Entry
    if shift.stock_entry_reference:
        se = frappe.get_doc("Stock Entry", shift.stock_entry_reference)
        if se.docstatus == 1:
            se.cancel()
        shift.db_set("stock_entry_reference", None)
        
    # Cancel Ledgers
    ledgers = frappe.get_all("Staff Liability Ledger", filters={"shift": shift_name})
    for l in ledgers:
        doc = frappe.get_doc("Staff Liability Ledger", l.name)
        if doc.docstatus == 1:
            doc.cancel()
            
    shift.db_set("status", "Open")
    frappe.msgprint("Shift reopened successfully. Accounting records cancelled.")


@frappe.whitelist()
def get_nozzle_prices(station, shift_date):
    """
    Returns a dictionary mapping nozzle names to their current item prices.
    Format: { "Nozzle Name": price, ... }
    """
    from frappe.utils import flt
    nozzle_prices = {}
    
    # 1. Get all Pump Groups for the station
    pump_groups = frappe.get_all("Pump Group", filters={"station": station}, pluck="name")
    if not pump_groups:
        return nozzle_prices
        
    # 2. Get all Nozzles in those groups
    nozzles = frappe.get_all("Pump Nozzle", filters={"pump_group": ["in", pump_groups]}, fields=["name", "fuel_tank"])
    
    # Cache to avoid duplicate queries for same fuel_product
    product_price_cache = {}
    
    for nozzle in nozzles:
        if not nozzle.fuel_tank:
            nozzle_prices[nozzle.name] = {"price": 0.0, "item": getattr(nozzle, "fuel_product", None)}
            continue
            
        fuel_product = frappe.db.get_value("Fuel Tank", nozzle.fuel_tank, "fuel_product")
        if not fuel_product:
            nozzle_prices[nozzle.name] = {"price": 0.0, "item": getattr(nozzle, "fuel_product", None)}
            continue
            
        if fuel_product in product_price_cache:
            nozzle_prices[nozzle.name] = product_price_cache[fuel_product]
        else:
            price_record = frappe.get_all("Item Price", 
                filters={
                    "item_code": fuel_product, 
                    "price_list": "Standard Selling", 
                    "valid_from": ("<=", shift_date)
                },
                fields=["price_list_rate"],
                order_by="valid_from desc",
                limit=1
            )
            price = flt(price_record[0].price_list_rate) if price_record else 0.0
            product_price_cache[fuel_product] = {"price": price, "item": fuel_product}
            nozzle_prices[nozzle.name] = {"price": price, "item": fuel_product}
            
    return nozzle_prices


@frappe.whitelist()
def get_till_pump_groups():
    return frappe.db.sql("SELECT parent, pump_group FROM `tabM-Pesa Till Pump Group` WHERE parenttype = 'M-Pesa Till'", as_dict=True)

@frappe.whitelist()
def send_end_shift_report(shift_name, html_content):
    shift = frappe.get_doc("Shift", shift_name)
    if not shift.station:
        frappe.throw("No Fuel Station linked to this shift.")
        
    station = frappe.get_doc("Fuel Station", shift.station)
    owner_email = station.owner_email
    if not owner_email:
        frappe.throw("Please configure an Owner Email in the Fuel Station document before sending the report.")
        
    # Inject minimal styling for PDF
    styled_html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: sans-serif; font-size: 12px; }}
            table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
            th, td {{ border: 1px solid #ddd; padding: 6px; text-align: left; }}
            th {{ background-color: #f4f4f4; }}
            .text-right {{ text-align: right; }}
            .text-center {{ text-align: center; }}
            .bold {{ font-weight: bold; }}
            .report-section-title {{ font-size: 14px; font-weight: bold; margin-bottom: 10px; background-color: #0f172a; color: white; padding: 8px; }}
            .report-section-title.green {{ background-color: #16a34a; }}
            .report-grid-2 {{ display: block; }}
            .summary-box {{ border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; }}
            .summary-row {{ display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; padding: 4px 0; }}
            .summary-row.total {{ font-weight: bold; font-size: 14px; border-top: 2px solid #000; margin-top: 5px; }}
            textarea {{ display: none; }} /* Don't print the textarea element itself */
        </style>
    </head>
    <body>
        <div style="font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 20px;">
            END OF SHIFT REPORT<br>
            <span style="font-size: 14px; font-weight: normal;">{shift.station} - {shift.shift_date}</span>
        </div>
        {html_content}
    </body>
    </html>
    """
    
    pdf_bytes = frappe.utils.pdf.get_pdf(styled_html)
    
    recipients = [e.strip() for e in owner_email.replace(';', ',').split(',') if e.strip()]
    frappe.sendmail(
        recipients=recipients,
        subject=f"End Shift Report: {shift.name} ({shift.shift_date})",
        message="Please find the attached End Shift Report.",
        attachments=[{"fname": f"{shift.name}.pdf", "fcontent": pdf_bytes}]
    )
    
    frappe.db.set_value("Shift", shift.name, "report_sent", 1)
    frappe.db.set_value("Shift", shift.name, "report_html", html_content)
    frappe.db.commit()
    
    return "Sent"

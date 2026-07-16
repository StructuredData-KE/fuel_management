import frappe
from frappe.model.document import Document

class Shift(Document):
    def validate(self):
        self.lock_shift_if_closed_for_csa()
        self.auto_fetch_opening_readings()
        self.calculate_expected_stock()

    def on_update(self):
        self.create_stock_entry_on_close()

    def lock_shift_if_closed_for_csa(self):
        if not self.is_new():
            old_status = frappe.db.get_value("Shift", self.name, "status")
            if old_status == "Closed":
                if "System Manager" not in frappe.get_roles(frappe.session.user):
                    frappe.throw("Closed Shifts cannot be modified. Please contact an Administrator.")

    def auto_fetch_opening_readings(self):
        if not self.pump_meter_readings and self.station:
            nozzles = frappe.get_all("Pump Nozzle", filters={"station": self.station}, fields=["name"])
            
            last_shift = frappe.get_all("Shift", filters={"station": self.station, "status": "Closed", "name": ("!=", self.name)}, order_by="end_time desc", limit=1)
            last_shift_doc = frappe.get_doc("Shift", last_shift[0].name) if last_shift else None
            
            for nozzle in nozzles:
                opening_elec = 0
                opening_manual = 0
                if last_shift_doc:
                    for row in last_shift_doc.pump_meter_readings:
                        if row.pump_nozzle == nozzle.name:
                            opening_elec = row.closing_electronic_meter
                            opening_manual = row.closing_manual_meter
                            break
                            
                self.append("pump_meter_readings", {
                    "pump_nozzle": nozzle.name,
                    "opening_electronic_meter": opening_elec,
                    "opening_manual_meter": opening_manual
                })

        if not self.dip_stick_readings and self.station:
            tanks = frappe.get_all("Fuel Tank", filters={"station": self.station}, fields=["name"])
            for tank in tanks:
                self.append("dip_stick_readings", {
                    "fuel_tank": tank.name
                })

    def calculate_expected_stock(self):
        if self.station and self.dip_stick_readings:
            station_doc = frappe.get_doc("Fuel Station", self.station)
            if not station_doc.default_forecourt_warehouse:
                return

            for row in self.dip_stick_readings:
                tank = frappe.db.get_value("Fuel Tank", row.fuel_tank, ["fuel_product"], as_dict=True)
                if tank and tank.fuel_product:
                    bin_qty = frappe.db.get_value("Bin", {"item_code": tank.fuel_product, "warehouse": station_doc.default_forecourt_warehouse}, "actual_qty") or 0.0
                    
                    sales = 0
                    if self.pump_meter_readings:
                        for p in self.pump_meter_readings:
                            if p.pump_nozzle:
                                pump_tank = frappe.db.get_value("Pump Nozzle", p.pump_nozzle, "fuel_tank")
                                if pump_tank == row.fuel_tank:
                                    sales += (p.sales_quantity_electronic or 0)
                                
                    row.expected_stock = bin_qty - sales

    def create_stock_entry_on_close(self):
        if self.status == "Closed" and not self.stock_entry_reference:
            station_doc = frappe.get_doc("Fuel Station", self.station)
            if not station_doc.default_forecourt_warehouse:
                frappe.throw("Cannot deduct stock: Fuel Station missing Default Forecourt Warehouse.")

            sales_per_item = {}
            for row in self.pump_meter_readings:
                if row.sales_quantity_electronic and row.sales_quantity_electronic > 0:
                    tank_name = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                    if tank_name:
                        item_code = frappe.db.get_value("Fuel Tank", tank_name, "fuel_product")
                        if item_code:
                            sales_per_item[item_code] = sales_per_item.get(item_code, 0) + row.sales_quantity_electronic

            if not sales_per_item:
                return

            se = frappe.new_doc("Stock Entry")
            se.stock_entry_type = "Material Issue"
            se.purpose = "Material Issue"
            se.from_warehouse = station_doc.default_forecourt_warehouse
            se.remarks = f"Fuel Sales for Shift {self.name}"

            for item_code, qty in sales_per_item.items():
                se.append("items", {
                    "item_code": item_code,
                    "qty": qty,
                    "s_warehouse": station_doc.default_forecourt_warehouse,
                    "cost_center": frappe.db.get_single_value("Global Defaults", "default_cost_center") or None
                })

            se.insert(ignore_permissions=True)
            se.submit()

            self.db_set("stock_entry_reference", se.name)
            frappe.msgprint(f"Stock Entry {se.name} automatically created to deduct fuel sales.")

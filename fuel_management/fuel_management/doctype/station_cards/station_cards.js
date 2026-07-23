frappe.ui.form.on('Station Cards', {
    setup: function(frm) {
        // Query Active Shift and configure fields
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Shift',
                filters: { 'status': 'Open' },
                fields: ['name', 'shift_date', 'head_csa'],
                limit: 1
            },
            callback: function(r) {
                if(r.message && r.message.length > 0) {
                    let shift = r.message[0];
                    if(frm.is_new()) {
                        frm.set_value('shift', shift.name);
                        frm.set_value('date', shift.shift_date || frappe.datetime.nowdate());
                    }
                    
                    // Fetch Shift Document to get assigned CSAs
                    frappe.call({
                        method: 'frappe.client.get',
                        args: { doctype: 'Shift', name: shift.name },
                        callback: function(r2) {
                            if(r2.message) {
                                let allowed_csas = [];
                                if(r2.message.head_csa) allowed_csas.push(r2.message.head_csa);
                                (r2.message.assigned_csas || []).forEach(row => {
                                    if(row.csa) allowed_csas.push(row.csa);
                                });
                                
                                frm.set_query('csa', function() {
                                    return {
                                        filters: {
                                            'name': ['in', allowed_csas]
                                        }
                                    };
                                });
                            }
                        }
                    });
                } else {
                    if(frm.is_new()) {
                        frappe.msgprint({
                            title: __('No Active Shift'),
                            indicator: 'red',
                            message: __('There is no currently open Shift. Please open a shift first.')
                        });
                    }
                }
            }
        });
    }
});

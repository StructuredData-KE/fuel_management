import re

path = 'fuel_management/fuel_management/page/shift_operation_spa/shift_operation_spa.js'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith('    function save_child_table(table_name, rows_data'):
        start_idx = i
        break

if start_idx != -1:
    for i in range(start_idx, len(lines)):
        if lines[i].startswith('    }'):
            # wait, the function ends with     }
            # let's be careful. Let's just find the exact line 1530 which is     }.
            # but let's check the next line to be sure.
            if i + 2 < len(lines) and '\.on(\'click\', \'#btn-save-drystock\'' in lines[i+2]:
                end_idx = i
                break

if start_idx != -1 and end_idx != -1:
    func_lines = lines[start_idx:end_idx+1]
    
    # Remove from original location
    del lines[start_idx:end_idx+1]
    
    # Find setup_actions
    setup_idx = -1
    for i, line in enumerate(lines):
        if line.startswith('function setup_actions(wrapper)'):
            setup_idx = i
            break
            
    if setup_idx != -1:
        # Insert right before setup_actions
        lines = lines[:setup_idx] + ["\n"] + func_lines + ["\n"] + lines[setup_idx:]
        
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print("Success!")
    else:
        print("Could not find setup_actions")
else:
    print("Could not find function bounds:", start_idx, end_idx)

import re

path = 'fuel_management/fuel_management/page/shift_operation_spa/shift_operation_spa.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Extract the function
match = re.search(r'(    function save_child_table\(table_name.*?\}\n)', content, re.DOTALL)
if match:
    func_text = match.group(1)
    
    # Remove it from its original location
    content = content.replace(func_text, '')
    
    # Convert it to global assignment and format properly
    global_func_text = func_text.replace('    function save_child_table', 'window.save_child_table = function')
    # Since we use window.save_child_table, we also need to append a semicolon at the end of the function block if we want to be strict, but it's optional in JS.
    
    # We must also replace all calls to save_child_table with window.save_child_table if we want to be safe, but actually save_child_table is called directly.
    # Wait, if we attach it to window, it is accessible as save_child_table directly in the browser!
    # Let's just put it as unction save_child_table(...) AT THE VERY END OF THE FILE!
    
    new_func_text = "\n" + func_text.strip() + "\n"
    
    content = content + new_func_text
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed!")
else:
    print("Function not found!")

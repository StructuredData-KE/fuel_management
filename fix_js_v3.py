import re

path = 'fuel_management/fuel_management/page/shift_operation_spa/shift_operation_spa.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# I will find the save_child_table function at the bottom and extract it
# Let's just restore from git first!

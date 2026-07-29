import frappe
def execute():
    try:
        with open('sites/apps.txt', 'r') as f:
            print("APPS.TXT CONTENT:")
            print(repr(f.read()))
    except Exception as e:
        print(e)

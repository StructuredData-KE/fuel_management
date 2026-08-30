import paramiko
import os
import stat

def put_dir(sftp, local_dir, remote_dir):
    for item in os.listdir(local_dir):
        if item in ['.git', '__pycache__', 'env', 'node_modules', '.github']:
            continue
            
        local_path = os.path.join(local_dir, item)
        remote_path = f"{remote_dir}/{item}"
        
        if os.path.isfile(local_path):
            try:
                sftp.put(local_path, remote_path)
            except Exception as e:
                print(f"Failed to put {local_path}: {e}")
        elif os.path.isdir(local_path):
            try:
                sftp.mkdir(remote_path)
            except IOError:
                pass # directory probably exists
            put_dir(sftp, local_path, remote_path)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("kilibetcore.co.ke", username="root", password="9ZMumn265VJ7F")
sftp = client.open_sftp()

local_app_dir = r"C:\Users\USER\Documents\ANTIGRAV\ERPNext\fuel_management\fuel_management"
remote_app_dir = "/home/frappe/frappe-bench/apps/fuel_management/fuel_management"

put_dir(sftp, local_app_dir, remote_app_dir)
sftp.close()

client.exec_command("cd /home/frappe/frappe-bench && sudo supervisorctl restart all && bench --site kilibetcore.co.ke clear-cache")
client.close()
print("Done uploading")

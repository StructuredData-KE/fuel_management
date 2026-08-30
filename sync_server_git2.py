import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("kilibetcore.co.ke", username="root", password="9ZMumn265VJ7F")

client.exec_command("git config --global --add safe.directory /home/frappe/frappe-bench/apps/fuel_management")
stdin, stdout, stderr = client.exec_command("cd /home/frappe/frappe-bench/apps/fuel_management && git reset --hard && git pull origin master")
print(stdout.read().decode())
print(stderr.read().decode())

client.exec_command("cd /home/frappe/frappe-bench && sudo supervisorctl restart all && bench --site kilibetcore.co.ke clear-cache")
client.close()

with open('executive_dashboard.html', 'r') as f:
    lines = f.readlines()
end_style = 0
for i in range(len(lines)):
    if '</style>' in lines[i]:
        end_style = i
        break
dash_start = 0
for i in range(end_style+1, len(lines)):
    if '<div class="exec-dash-wrapper">' in lines[i]:
        dash_start = i
last_dash = dash_start
for i in range(dash_start+1, len(lines)):
    if '<div class="exec-dash-wrapper">' in lines[i]:
        last_dash = i
final = lines[:end_style+1] + lines[last_dash:]
with open('executive_dashboard.html', 'w') as f:
    f.writelines(final)
print(len(final))

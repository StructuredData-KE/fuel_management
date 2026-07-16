from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in fuel_management/__init__.py
from fuel_management import __version__ as version

setup(
	name="fuel_management",
	version=version,
	description="Fuel Management System",
	author="USER",
	author_email="user@example.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)

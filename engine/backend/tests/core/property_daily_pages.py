"""Made-up Property Daily pages, shaped like the real ones (mapped on 15 Nov, PLAN-V16 T2-2).

Every company, person, address and number here is invented. No real page is ever saved in git.
The people's names, emails and phone numbers are here on purpose: the parser must drop them.
"""

NAV = """
<form action="/cgi-bin/marketview.cgi" method="post"><input name="search">
<select name="search_type"><option>All</option><option>Organisation</option>
<option>Appointments</option><option>Contacts</option><option>Location</option></select></form>
<table><tr><td><a href="/cgi-bin/main.cgi">Home</a></td><td><a href="/cgi-bin/marketview.cgi">
MarketView</a></td><td><a href="/cgi-bin/shortlist.cgi">My ShortList</a></td>
<td><a href="/cgi-bin/logout.cgi">Logout</a></td></tr></table>
"""

DAILY = f"""<html><head><title>Property Daily</title></head><body>{NAV}
<table><tr><td>NATIONAL NEWS IN BRIEF - (With Summary)</td></tr>
<tr><td><a href="#summary_item_901">Sample Logistics Pty Ltd - (UPDATE) Active requirement for
1,200-1,500sqm in Perth / Tenant Partners handling advocacy</a></td></tr>
<tr><td><a href="#summary_item_902">Example Engineering - (UPDATE) Design tender for 800sqm in
Melbourne / Sample Design Studio appointed</a></td></tr></table>

<a name="summary_item_901"></a>
<table>
<tr><td>Sample Logistics Pty Ltd&nbsp;&nbsp;-&nbsp;&nbsp;(UPDATE) Active requirement for
1,200-1,500sqm in Perth / Tenant Partners handling advocacy</td></tr>
<tr><td>PERTH</td></tr>
<tr><td>Appointments</td><td>Property Adviser:<br>Tenant Partners<br>Interior Designer:<br>
Not yet appointed<br>Previous Property Adviser:<br>Old Advisers Pty Ltd</td></tr>
<tr><td>Requirements</td><td>1,200 - 1,500sqm</td></tr>
<tr><td>Further details expected</td><td>March 2027</td></tr>
<tr><td><p>ACTIVE : Sample Logistics is in the market for space. Call Jane Citizen on
0412 345 678 or jane.citizen@samplelogistics.example for details.</p>
<a href="http://www.spatialgroup.com.au/cgi-bin/report.cgi?id=901">Click here to read more</a>
<a href="http://www.spatialgroup.com.au/main/pd/shortlist/add?ids=901">Add to shortlist</a></td>
<td>Current Location:<br>Level 12, (1,100sqm),<br>Sample Tower<br>100 Example Street<br><br>
PERTH, WA, 6000<br><br>Lease Expiry:<br>30 June 2028</td></tr>
</table>

<a name="summary_item_902"></a>
<table>
<tr><td>Example Engineering&nbsp;&nbsp;-&nbsp;&nbsp;(UPDATE) Design tender for 800sqm in
Melbourne / Sample Design Studio appointed</td></tr>
<tr><td>MELBOURNE</td></tr>
<tr><td>Appointments</td><td>Property Adviser:<br>Not yet appointed<br>Interior Designer:<br>
Sample Design Studio</td></tr>
<tr><td><p>POTENTIAL : Example Engineering is fitting out its new floor. Ask John Smith
(john@example-engineering.example, (03) 9123 4567).</p></td>
<td>Current Location:<br>Part level 3 - Suite 2, (800sqm),<br>20 Sample Road<br>
SOUTHBANK, VIC, 3006</td></tr>
</table>
<p>Copyright The Sample Group. enquiries@sample.example</p>
</body></html>"""

REPORT = f"""<html><head><title>Sample Logistics Pty Ltd - (UPDATE) Active requirement for
1,200-1,500sqm in Perth / Tenant Partners handling advocacy</title></head><body>{NAV}
<table><tr><td>
<table><tr><td><p class="details"><strong>ACTIVE:</strong> Sample Logistics is quietly in the
market for 1,200-1,500sqm in Perth. Its lease at 100 Example Street ends in June 2028.</p>
<p class="details">As reported by Property Daily on 10 April 2024, Sample Logistics was planning a
refurbishment with Sample Design Studio.</p>
<p class="details">As reported by Property Daily in March 2009, Sample Logistics moved into
Sample Tower.</p></td></tr>
<tr><td class="header"><div>KEY CONTACTS</div></td></tr>
<tr class="key-contacts"><td><p class="details">Jane Citizen<br>(Chief Financial Officer)<br>
Email: jane.citizen@samplelogistics.example<br>Direct: (08) 9123 4567</p>
<p class="details"><b>Sample Logistics Pty Ltd</b><br>Level 12,<br>Sample Tower,<br>
100 Example Street,<br>PERTH, WA, 6000<br><br>Tel: (08) 9000 0000<br>
Internet: www.samplelogistics.example</p></td></tr>
<tr><td class="header">PROJECT APPOINTMENTS</td></tr>
<tr><td><p>Property Adviser</p><p>Sam Agent<br>Email: sam@tenantpartners.example</p>
<p>Tenant Partners<br>Internet: www.tenantpartners.example</p></td></tr>
</table></td>
<td class="col2"><table><tr><td><table class="summary">
<tr><td>Active Space Requirement</td></tr>
<tr><td>PERTH</td></tr>
<tr class="appointments"><td><b>Published</b></td><td>13 November 2026</td></tr>
<tr class="appointments"><td><b>Appointments</b></td><td>Property Adviser:<br>Tenant Partners<br>
Interior Designer:<br>Not yet appointed<br>Previous Interior Designer:<br>Sample Design Studio</td>
</tr>
<tr class="requirements"><td><b>Requirements</b></td><td>1,200 - 1,500sqm</td></tr>
<tr class="timeframe"><td><b>Further details expected</b></td><td>March 2027</td></tr>
</table></td></tr></table>
<p><table><tr><td class="header">LOCATIONS</td></tr>
<tr class="requirements"><td><div class="summary"><div><b>Current:</b></div>
<div>Level 12, (1,100sqm),<br>Sample Tower,<br>100 Example Street,<br>PERTH, WA, 6000<br>
<div><strong>Lease Expiry:</strong><br>30 June 2028</div></div>
<div><b>Future:</b><br>NOT YET DETERMINED - WITHIN PERTH CBD</div>
<div><b>Previous:</b></div>
<div>Level 4, (600sqm),<br>8 Old Lane,<br>WEST PERTH, WA, 6005<br>
<strong>Lease Expiry:</strong><br>March 2015</div>
<div>(250sqm),<br>1 First Street,<br>FREMANTLE, WA, 6160<br>(Lease Expiry: February 2009)</div>
</div></td></tr></table></p>
<p>Print Profile</p><p>Request Update</p>
</td></tr></table>
<p>GPO BOX 1 SAMPLE NSW 2001 enquiries@sample.example</p>
</body></html>"""

SEARCH = f"""<html><head><title>Home</title></head><body>{NAV}
<p>Search results for "Sample Logistics"</p>
<table>
<tr><th></th><th>Date</th><th>Organisation</th><th>Category</th><th>Description</th>
<th>Markets</th><th>Space (sqm)</th><th>Next Update</th><th>Appointments</th></tr>
<tr><td></td><td>13 November 2026</td><td><a href="/cgi-bin/report.cgi?id=901">Sample Logistics
Pty Ltd</a></td><td></td><td>ASR</td>
<td>(UPDATE) Active requirement for 1,200-1,500sqm in Perth</td>
<td>Perth</td><td>1,200 - 1,500</td><td>March 2027</td><td>Property Adviser:<br>Tenant Partners
</td></tr>
<tr><td></td><td>19 October 2019</td><td><a href="/cgi-bin/report.cgi?id=355">Sample Logistics
</a></td><td></td><td>SC</td><td>Space commitment to 600sqm in Melbourne</td><td>Melbourne</td>
<td>600</td><td>January 2020</td><td></td></tr>
</table></body></html>"""

LEASES = f"""<html><head><title>Marketview</title></head><body>{NAV}
<p>MarketView for leases expiring between November 2027 and November 2028</p>
<form action="/main/pd/shortlist/add" method="post"><table>
<tr><th></th><th>Published</th><th>Type</th><th>Organisation</th><th>Location</th>
<th>Space (sqm)</th><th>Expiry</th><th>Status</th><th>Appointments</th><th>Market</th><th></th></tr>
<tr><td><input type="checkbox" name="ids" value="7001"></td><td>13 November 2026</td><td></td>
<td><a href="/cgi-bin/lease_expiry_news.cgi/report?id=7001">Sample Logistics Pty Ltd</a></td>
<td>Level 12<br>Sample Tower<br>100 Example Street<br>PERTH, WA, 6000</td><td>1,100sqm</td>
<td>30 June 2028</td><td></td><td>Building Owner:<br>Sample Property Trust</td>
<td>Perth</td><td></td></tr>
<tr><td><input type="checkbox" name="ids" value="7002"></td><td>2 November 2026</td><td></td>
<td><a href="/cgi-bin/lease_expiry_news.cgi/report?id=7002">Example Insurance Group</a></td>
<td>Part level 23 - suite 3<br>25 Sample Street<br>SYDNEY, NSW, 2000</td><td>2,940sqm</td>
<td>7 August 2028</td><td></td><td></td><td>Sydney CBD</td><td></td></tr>
<tr><td><input type="checkbox" name="ids" value="7003"></td><td>30 October 2026</td><td></td>
<td><a href="/cgi-bin/lease_expiry_news.cgi/report?id=7003">Coast Sample Co</a></td>
<td>Level 2<br>3 Beach Road<br>ROBINA, QLD, 4226</td><td>1,042sqm</td>
<td>August 2027</td><td></td><td></td><td>Regional Areas</td><td></td></tr>
</table></form></body></html>"""

SIGNED_OUT = """<html><head><title>Login Failure</title></head><body>
<p>Login Failed!</p><p>Please re-enter your username and password.</p>
<form action="/main/login" method="post"><input name="login"><input name="password"
type="password"><input type="hidden" name="dest"><input type="checkbox" name="remember">
<button type="submit">Login</button></form>
<form action="/main/password" method="post"><input name="email"></form></body></html>"""

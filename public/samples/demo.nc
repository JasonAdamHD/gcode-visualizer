%
(Demo program for the CNC Toolpath Visualizer)
(Hand-written for the demo; contains no customer data.)
(Inches. Z 0 is the sheet top; the machine starts at the sheet origin at safe height.)
G20 G90 G17
M3 S18000
G0 Z0.5

(Square, 10 x 10 in, in two passes)
G0 X5 Y5
G1 Z-0.25 F60
G1 X15 F200
Y15
X5
Y5
G1 Z-0.5 F60
G1 X15 F200
Y15
X5
Y5
G0 Z0.5

(Circle, radius 4 in, by I/J)
G0 X34 Y10
G1 Z-0.25 F60
G2 X34 Y10 I-4 J0 F200
G0 Z0.5

(Helix, radius 2 in, two turns down to Z -0.5)
G0 X52 Y10
G1 Z0 F60
G3 X52 Y10 Z-0.25 I-2 J0 F100
G3 X52 Y10 Z-0.5 I-2 J0
G0 Z0.5

(Half circle by R)
G0 X60 Y30
G1 Z-0.25 F60
G3 X70 Y30 R5 F200
G0 Z0.5

(Deliberate mistake: this slot runs past the right edge of the 96 in sheet)
G0 X90 Y40
G1 Z-0.25 F60
G1 X100 F200
G0 Z0.5

G0 X0 Y0
M5
M30
%

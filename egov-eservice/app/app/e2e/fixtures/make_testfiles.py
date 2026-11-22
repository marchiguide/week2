# make_testfiles.py — ต้นฉบับจาก TEST-DATA ข้อ 11 (อ้างอิง · ชุด test ใช้ make-testfiles.cjs ที่ให้ไบต์เดียวกัน)
# รันใน fixtures/:  python make_testfiles.py  → fixtures/testfiles/
import os, struct, zlib
os.makedirs("testfiles", exist_ok=True)

def pdf(n):
    head = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n"
    tail = b"\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    pad = n - len(head) - len(tail)
    assert pad >= 0
    return head + b" " * pad + tail

def png(n):
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    base = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) \
         + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")
    pad = n - len(base) - 12
    return base[:-12] + chunk(b"tEXt", b"k\x00" + b"x" * (pad - 2)) + base[-12:]

def jpg(n):
    soi = b"\xff\xd8"; app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    pad = n - len(soi) - len(app0) - 2 - 4
    return soi + app0 + b"\xff\xfe" + struct.pack(">H", pad + 2) + b"x" * pad + b"\xff\xd9"

def w(name, data):
    open(os.path.join("testfiles", name), "wb").write(data)

for n in ["ok-id.pdf", "id-card.pdf", "map.pdf", "plan.pdf", "deed.pdf"] + [f"multi-{i}.pdf" for i in range(1, 7)]:
    w(n, pdf(1024))
w("real.jpg", jpg(1024)); w("real.png", png(1024)); w("plan-as-jpg.jpg", jpg(1024))
for n in (5242879, 5242880, 5242881): w(f"size-{n}.pdf", pdf(n))
w("fake-text.pdf", b"hello"); w("fake-text.jpg", b"hello"); w("notes.txt", b"hello")
w("exe-as.png", b"MZ" + b"\x00" * 1022)

for f in sorted(os.listdir("testfiles")):
    print(f, os.path.getsize(os.path.join("testfiles", f)))

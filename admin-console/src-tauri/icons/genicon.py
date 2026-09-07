import zlib, struct, os
OUT = os.path.dirname(os.path.abspath(__file__))
RGB = (108, 92, 231)  # 星璃紫

def make_png(path, size=512):
    raw = bytearray()
    for _ in range(size):
        raw.append(0)
        raw.extend(RGB * size)
    comp = zlib.compress(bytes(raw), 9)
    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

def make_ico(png_path, ico_path):
    png = open(png_path, "rb").read()
    with open(ico_path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, 1))
        f.write(struct.pack("<BBBB", 0, 0, 0, 0))
        f.write(struct.pack("<HH", 1, 32))
        f.write(struct.pack("<I", len(png)))
        f.write(struct.pack("<I", 22))
        f.write(png)

make_png(os.path.join(OUT, "icon.png"), 512)
make_ico(os.path.join(OUT, "icon.png"), os.path.join(OUT, "icon.ico"))
print("generated:", sorted(os.listdir(OUT)))
for n in ("icon.png", "icon.ico"):
    p = os.path.join(OUT, n)
    print(n, os.path.getsize(p), "bytes")

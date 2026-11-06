from pathlib import Path
import argparse
import struct,zlib,hashlib,json

parser = argparse.ArgumentParser(description='Export six composed screenshots as opaque RGB24 PNGs.')
parser.add_argument('work_dir', nargs='?', type=Path, default=Path(__file__).resolve().parent,
                    help='Directory containing rendered/; writes upload/ and asset-verification.json here.')
P = parser.parse_args().work_dir.resolve()
SIG=b'\x89PNG\r\n\x1a\n'
def decode(data):
 assert data[:8]==SIG
 pos=8;chunks=[];compressed=b'';head=None
 while pos<len(data):
  length=struct.unpack('>I',data[pos:pos+4])[0];kind=data[pos+4:pos+8];value=data[pos+8:pos+8+length];crc=struct.unpack('>I',data[pos+8+length:pos+12+length])[0]
  assert zlib.crc32(kind+value)&0xffffffff==crc
  chunks.append((kind,value));pos+=length+12
  if kind==b'IHDR':head=struct.unpack('>IIBBBBB',value)
  if kind==b'IDAT':compressed+=value
 width,height,depth,ctype,comp,filt,interlace=head
 assert depth==8 and ctype in (2,6) and interlace==0 and comp==0 and filt==0
 n=4 if ctype==6 else 3;stride=width*n;raw=zlib.decompress(compressed);rows=[];prev=bytearray(stride);idx=0
 def paeth(a,b,c):
  p=a+b-c;pa,pb,pc=abs(p-a),abs(p-b),abs(p-c)
  return a if pa<=pb and pa<=pc else b if pb<=pc else c
 for _ in range(height):
  filterbyte=raw[idx];idx+=1;row=bytearray(raw[idx:idx+stride]);idx+=stride
  for x in range(stride):
   a=row[x-n] if x>=n else 0;b=prev[x];c=prev[x-n] if x>=n else 0
   if filterbyte==1:row[x]=(row[x]+a)&255
   elif filterbyte==2:row[x]=(row[x]+b)&255
   elif filterbyte==3:row[x]=(row[x]+((a+b)//2))&255
   elif filterbyte==4:row[x]=(row[x]+paeth(a,b,c))&255
   else:assert filterbyte==0
  if n==4:
   assert all(row[x]==255 for x in range(3,stride,4))
   rgb=bytearray(width*3)
   rgb[0::3]=row[0::4];rgb[1::3]=row[1::4];rgb[2::3]=row[2::4]
  else:rgb=row
  rows.append(bytes(rgb));prev=row
 assert idx==len(raw)
 return width,height,rows,chunks

def chunk(k,v):return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v)&0xffffffff)
rows=[]
(P/'upload').mkdir(exist_ok=True)
for f in sorted((P/'rendered').glob('0[1-6]-*.png')):
 w,h,pixels,chunks=decode(f.read_bytes());assert(w,h)==(1080,1920)
 out=SIG+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))
 for k,v in chunks:
  if k in (b'iCCP',b'sRGB',b'gAMA',b'cHRM',b'pHYs'):out+=chunk(k,v)
 out+=chunk(b'IDAT',zlib.compress(b''.join(b'\0'+r for r in pixels),9))+chunk(b'IEND',b'')
 target=P/'upload'/f.name;target.write_bytes(out)
 dw,dh,dp,_=decode(target.read_bytes());assert(w,h,pixels)==(dw,dh,dp)
 assert len(out)<8*1024*1024
 rows.append({'name':f.name,'width':w,'height':h,'bits':24,'alpha':False,'bytes':len(out),'sha256':hashlib.sha256(out).hexdigest(),'composition_raster_rgb_identical':True,'rgb_sha256':hashlib.sha256(b''.join(pixels)).hexdigest()})
assert len(rows)==6
result={'locale':'ru-RU','processing':'Deterministic AppKit composition: actual native screenshot uniformly scaled in a neutral rounded frame; marketing headline and background outside UI. Opaque alpha strip only on final raster; final RGB rows byte-identical to composed raster, all chunk CRC verified. Artwork is intentionally not pixel-identical to full-size native capture.','images':rows}
(P/'asset-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(rows,ensure_ascii=False))

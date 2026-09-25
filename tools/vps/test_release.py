import importlib.util,io,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('release.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ReleaseTests(unittest.TestCase):
 def test_latest_ci_attempt_must_pass(self):
  base={'head_sha':'a'*40,'head_branch':'master','event':'push','status':'completed','run_number':7}
  for conclusion,expected in [('failure',False),('cancelled',False),('success',True)]:
   with patch.object(r,'api',return_value={'workflow_runs':[{**base,'conclusion':conclusion,'run_attempt':2},{**base,'conclusion':'success','run_attempt':1}]}):self.assertEqual(r.ci_passed('a'*40),expected)
 def test_pr_ci_cannot_authorize_deployment(self):
  with patch.object(r,'api',return_value={'workflow_runs':[{'head_sha':'a'*40,'head_branch':'master','event':'pull_request','status':'completed','conclusion':'success'}]}):self.assertFalse(r.ci_passed('a'*40))
 def test_archive_rejects_traversal_and_links(self):
  for name,kind in [('../escape',tarfile.REGTYPE),('server/link',tarfile.SYMTYPE),('/absolute',tarfile.REGTYPE)]:
   stream=io.BytesIO()
   with tarfile.open(fileobj=stream,mode='w') as tf:
    item=tarfile.TarInfo(name);item.type=kind;tf.addfile(item)
   stream.seek(0)
   with tarfile.open(fileobj=stream) as tf:
    with self.assertRaises(RuntimeError):r.safe_members(tf)
 def test_failed_activation_restores_previous_configuration(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);drop=root/'release.conf';drop.write_text('previous configuration')
   with patch.object(r,'DROPIN',drop),patch.object(r,'command',return_value='0'):
    with self.assertRaises(RuntimeError):r.activate(root/'new')
   self.assertEqual(drop.read_text(),'previous configuration')
 def test_failed_first_activation_removes_new_dropin(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);drop=root/'release.conf'
   with patch.object(r,'DROPIN',drop),patch.object(r,'command',return_value='0'):
    with self.assertRaises(RuntimeError):r.activate(root/'new')
   self.assertFalse(drop.exists())
if __name__=='__main__':unittest.main()

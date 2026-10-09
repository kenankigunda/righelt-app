import unittest
from righelt_training.benchmark_report import metric

class BenchmarkTest(unittest.TestCase):
    def test_failures_do_not_disappear_from_percentiles(self):
        rows=[{'status':'completed','durationMs':1} for _ in range(89)]+[{'status':'failed','durationMs':10} for _ in range(11)]
        r=metric(rows,5)
        self.assertFalse(r['softTargetPassed']);self.assertIsNone(r['p90Ms']);self.assertIsNone(r['p99Ms'])
        self.assertEqual(r['attempts'],100);self.assertEqual(r['failedOrUnfinished'],11)
    def test_interruptions_separate_and_outliers_preserved(self):
        rows=[{'status':'completed','durationMs':3},{'status':'completed','durationMs':7},{'status':'interrupted','durationMs':1}]
        r=metric(rows,5);self.assertEqual(r['attempts'],2);self.assertEqual(r['interruptions'],1)
        self.assertEqual(len(r['outliers']),2)

if __name__=='__main__':unittest.main()

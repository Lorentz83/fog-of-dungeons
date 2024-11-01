package metric

import (
	"cmp"
	"fmt"
	"runtime"
	"slices"
	"sync/atomic"
)

var allMetrics []metric

func saveMetric(m metric) {
	allMetrics = append(allMetrics, m)
	slices.SortFunc(allMetrics, func(a, b metric) int {
		return cmp.Compare(a.Name(), b.Name())
	})
}

func system() []string {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return []string{
		fmt.Sprintf("/system/go_version: %v", runtime.Version()),
		fmt.Sprintf("/system/goroutines: %v", runtime.NumGoroutine()),
		fmt.Sprintf("/system/memory_used: %v", ms.Sys),
		fmt.Sprintf("/system/num_gc: %v", ms.NumGC),
	}
}

// Summary returns the String() summary of all the registered metrics.
// The order is guaranteed to be stable.
func Summary() []string {
	ret := system()
	for _, m := range allMetrics {
		ret = append(ret, m.String())
	}
	return ret
}

type named struct {
	name string
}

func (n named) Name() string {
	return n.name
}

type metric interface {
	Name() string
	String() string
}

type Int struct {
	named
	v atomic.Int64
}

// Add adds the value to the metric.
func (m *Int) Add(n int) {
	m.v.Add(int64(n))
}

func (m *Int) String() string {
	return fmt.Sprintf("%s: %v", m.name, m.v.Load())
}

// NewInt registers and return a new Int32 metric.
func NewInt(name string) *Int {
	r := &Int{named: named{name: name}}
	saveMetric(r)
	return r
}

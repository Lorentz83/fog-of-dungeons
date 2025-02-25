package protocol

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

var (
	// All the top level messages that can be sent.
	sendableMsgs = []sendable{
		Negotiation{},
		WelcomeMaster{},
		WelcomePlayer{},
		Error{},
		NewPlayer{},
	}
	// All the top level messages that can be received.
	receivableMsgs = []any{
		ControlRoom{},
		JoinRoom{},
	}
)

func TestSendable(t *testing.T) {
	tests := sendableMsgs

	var ts strings.Builder // Collects the TypeScript definition.
	for _, tt := range tests {
		j, err := json.Marshal(tt)
		if err != nil {
			t.Errorf("cannot marshal %+v uin json: %v", tt, err)
			continue
		}

		m := map[string]any{}
		if err := json.Unmarshal(j, &m); err != nil {
			t.Errorf("cannot unmarshal %+v uin json: %v", tt, err)
			continue
		}

		rt := reflect.TypeOf(tt)
		name := rt.Name()
		if got := m["type"]; got != name {
			t.Errorf("json.type = %q want %q", got, name)
		}

		// Typescript definition
		ts.WriteString("interface ")
		ts.WriteString(name)
		ts.WriteString(" {\n")
		ts.WriteString(fmt.Sprintf("  type?: '%s';\n", name))
		for i := range rt.NumField() {
			f := rt.Field(i)
			tag := f.Tag.Get("json")

			fn := strings.Split(tag, ",")[0]
			ft := f.Type.Name()
			if ft == "" {
				ft = "any"
			}
			optional := ""
			if strings.Contains(tag, "omitempty") {
				optional = "?"
			}
			ts.WriteString(fmt.Sprintf("  %s%v: %s;\n", fn, optional, ft))
		}
		ts.WriteString("}\n")

		ts.WriteString(fmt.Sprintf("function As%s(obj: any): %s | null {\n", name, name))
		ts.WriteString(fmt.Sprintf("  if ( obj.type !== '%s') return null;\n", name))
		ts.WriteString(fmt.Sprintf("  return obj as %s;\n", name))
		ts.WriteString("}\n\n")
	}

	t.Errorf("typescript classes:\n\n%s", ts.String())
}

func TestReceivable(t *testing.T) {
	tests := receivableMsgs

	var ts strings.Builder // Collects the TypeScript definition.
	for _, tt := range tests {
		rt := reflect.TypeOf(tt)
		name := rt.Name()

		// Typescript definition
		ts.WriteString("class ")
		ts.WriteString(name)
		ts.WriteString(" {\n  constructor(")
		var fields []string
		for i := range rt.NumField() {
			f := rt.Field(i)

			fn := strings.Split(f.Tag.Get("json"), ",")[0]
			ft := f.Type.Name()
			if ft == "" {
				ft = "any"
			}
			fields = append(fields, fmt.Sprintf("public %s: %s", fn, ft))
		}
		ts.WriteString(strings.Join(fields, ", "))
		ts.WriteString(") {}\n}\n\n")
	}

	t.Logf("typescript classes:\n\n%s", ts.String())
}

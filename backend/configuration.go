package main

import (
	"fmt"
	"math"
	"strings"
)

const managedHeader = "# Managed by PEQ Studio. Changes made here will be overwritten."

type filter struct {
	Type    string  `json:"type"`
	Enabled bool    `json:"enabled"`
	FcHz    float64 `json:"fcHz"`
	GainDb  float64 `json:"gainDb"`
	Q       float64 `json:"q"`
}

type channel struct {
	PreampDb float64  `json:"preampDb"`
	Filters  []filter `json:"filters"`
}

type configuration struct {
	Version        int     `json:"version"`
	Name           string  `json:"name"`
	Enabled        bool    `json:"enabled"`
	FiltersEnabled *bool   `json:"filtersEnabled,omitempty"`
	Linked         bool    `json:"linked"`
	SampleRate     int     `json:"sampleRate"`
	Left           channel `json:"left"`
	Right          channel `json:"right"`
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func (c configuration) render() ([]byte, error) {
	if c.Version != 1 {
		return nil, fmt.Errorf("unsupported configuration version: %d", c.Version)
	}
	switch c.SampleRate {
	case 44100, 48000, 96000, 192000:
	default:
		return nil, fmt.Errorf("unsupported sample rate: %d", c.SampleRate)
	}
	if c.Linked {
		c.Right = c.Left
	}
	for i, ch := range []channel{c.Left, c.Right} {
		if !finite(ch.PreampDb) || ch.Filters == nil {
			return nil, fmt.Errorf("channel %d needs a finite preamp and a filter list", i+1)
		}
		for j, f := range ch.Filters {
			switch f.Type {
			case "PK", "LSC", "HSC", "LP", "HP":
			default:
				return nil, fmt.Errorf("channel %d, filter %d: unsupported type %q", i+1, j+1, f.Type)
			}
			if !finite(f.FcHz) || f.FcHz < 20 || f.FcHz > 20000 || !finite(f.GainDb) || !finite(f.Q) || f.Q < 0.1 || f.Q > 20 {
				return nil, fmt.Errorf("channel %d, filter %d: frequency must be 20–20000 Hz, gain finite, and Q 0.1–20", i+1, j+1)
			}
		}
	}
	var out strings.Builder
	fmt.Fprintln(&out, managedHeader)
	fmt.Fprintln(&out, "# Add Include: peqstudio.txt to your Equalizer APO configuration to use this file.")
	// Names are untrusted metadata; never let them inject APO directives.
	name := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, c.Name)
	fmt.Fprintf(&out, "# Preset: %s\n", name)
	if c.FiltersEnabled != nil && !*c.FiltersEnabled {
		fmt.Fprintln(&out, "# Comparison B: filters bypassed; channel preamps retained when power is on.")
		c.Left.Filters = nil
		c.Right.Filters = nil
	}
	if !c.Enabled {
		fmt.Fprintln(&out, "# PEQ bypassed (including preamp).")
	} else if c.Linked {
		writeChannel(&out, "L R", c.Left)
	} else {
		writeChannel(&out, "L", c.Left)
		writeChannel(&out, "R", c.Right)
	}
	// Leave subsequent commands in the parent configuration targeting all channels.
	fmt.Fprintln(&out, "Channel: ALL")
	return []byte(strings.ReplaceAll(out.String(), "\n", "\r\n")), nil
}

func writeChannel(out *strings.Builder, name string, c channel) {
	fmt.Fprintf(out, "\nChannel: %s\nPreamp: %g dB\n", name, c.PreampDb)
	for i, f := range c.Filters {
		state := "OFF"
		if f.Enabled {
			state = "ON"
		}
		kind := f.Type
		if kind == "LP" || kind == "HP" {
			// APO's LP/HP ignore custom Q; the Q variants preserve the editor response.
			kind += "Q"
			fmt.Fprintf(out, "Filter %d: %s %s Fc %g Hz Q %g\n", i+1, state, kind, f.FcHz, f.Q)
		} else {
			fmt.Fprintf(out, "Filter %d: %s %s Fc %g Hz Gain %g dB Q %g\n", i+1, state, kind, f.FcHz, f.GainDb, f.Q)
		}
	}
}

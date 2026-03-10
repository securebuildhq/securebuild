package logger

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/fatih/color"
	"go.uber.org/zap"
	"go.uber.org/zap/buffer"
	"go.uber.org/zap/zapcore"
)

var (
	log  *zap.Logger
	atom zap.AtomicLevel
)

// Create a buffer pool for our encoder
var bufferPool = buffer.NewPool()

func init() {
	atom = zap.NewAtomicLevel()
	atom.SetLevel(zapcore.DebugLevel)

	encoderCfg := zapcore.EncoderConfig{
		MessageKey:       "msg",
		LevelKey:         "lvl",
		NameKey:          zapcore.OmitKey,
		TimeKey:          "time",
		CallerKey:        "caller", // Enable caller info
		FunctionKey:      zapcore.OmitKey,
		StacktraceKey:    zapcore.OmitKey,
		LineEnding:       zapcore.DefaultLineEnding,
		EncodeLevel:      zapcore.CapitalLevelEncoder,
		EncodeTime:       zapcore.TimeEncoderOfLayout("15:04:05"),
		EncodeName:       zapcore.FullNameEncoder,
		EncodeDuration:   zapcore.StringDurationEncoder,
		EncodeCaller:     zapcore.ShortCallerEncoder, // Add caller encoder
		ConsoleSeparator: " ",
	}

	core := zapcore.NewCore(
		NewKVEncoder(encoderCfg),
		zapcore.AddSync(os.Stdout),
		atom,
	)

	log = zap.New(core, zap.AddCaller(), zap.AddCallerSkip(1)) // Add caller option and skip wrapper function
}

type kvEncoder struct {
	zapcore.Encoder
	*zapcore.EncoderConfig
}

func NewKVEncoder(cfg zapcore.EncoderConfig) zapcore.Encoder {
	return &kvEncoder{
		Encoder:       zapcore.NewConsoleEncoder(cfg),
		EncoderConfig: &cfg,
	}
}

func (e *kvEncoder) EncodeEntry(ent zapcore.Entry, fields []zapcore.Field) (*buffer.Buffer, error) {
	line := bufferPool.Get()

	// Add timestamp if available
	if !ent.Time.IsZero() {
		line.AppendString(ent.Time.Format("15:04:05"))
		line.AppendString("  ")
	}

	// Add color based on log level with consistent padding
	var levelStr string
	levelText := ent.Level.CapitalString()

	// Pad level string to 5 characters for consistent alignment
	paddedLevel := fmt.Sprintf("%-5s", levelText)

	switch ent.Level {
	case zapcore.ErrorLevel:
		levelStr = color.RedString(paddedLevel)
	case zapcore.WarnLevel:
		levelStr = color.New(color.FgHiYellow).Sprint(paddedLevel) // Orange/yellow for warnings
	default:
		levelStr = paddedLevel
	}

	line.AppendString(levelStr)
	line.AppendString("  ")

	// Add caller information if available
	if ent.Caller.Defined {
		line.AppendString("[")
		line.AppendString(ent.Caller.TrimmedPath())
		line.AppendString("]")
		line.AppendString(" ")
	}

	if ent.Message != "" {
		// Color the message as well for errors and warnings
		var messageStr string
		switch ent.Level {
		case zapcore.ErrorLevel:
			messageStr = color.RedString(ent.Message)
		case zapcore.WarnLevel:
			messageStr = color.New(color.FgHiYellow).Sprint(ent.Message)
		default:
			messageStr = ent.Message
		}
		line.AppendString(messageStr)
		line.AppendString("  ")
	}

	for i, f := range fields {
		if i > 0 {
			line.AppendString(" ")
		}
		line.AppendString(f.Key)
		line.AppendString("=")

		switch f.Type {
		case zapcore.StringType:
			line.AppendString(f.String)
		case zapcore.BoolType:
			if f.Integer == 1 {
				line.AppendString("true")
			} else {
				line.AppendString("false")
			}
		case zapcore.Int64Type, zapcore.Int32Type, zapcore.Int16Type, zapcore.Int8Type:
			line.AppendString(fmt.Sprint(f.Integer))
		case zapcore.TimeType:
			t := time.Unix(0, f.Integer)
			if loc, ok := f.Interface.(*time.Location); ok {
				t = t.In(loc)
			}
			line.AppendString(t.Format(time.RFC3339))
		default:
			line.AppendString(fmt.Sprint(f.Interface))
		}
	}

	line.AppendString("\n")

	return line, nil
}

func SetDebug() {
	atom.SetLevel(zapcore.DebugLevel)
}

func SetLevel(level string) {
	switch strings.ToLower(level) {
	case "debug":
		atom.SetLevel(zapcore.DebugLevel)
	case "info":
		atom.SetLevel(zapcore.InfoLevel)
	case "warn", "warning":
		atom.SetLevel(zapcore.WarnLevel)
	case "error":
		atom.SetLevel(zapcore.ErrorLevel)
	default:
		atom.SetLevel(zapcore.DebugLevel)
	}
}

func GetLogger() *zap.Logger {
	return log
}

func Error(err error, fields ...zap.Field) {
	log.Error("error", append(fields, zap.Error(err))...)
}

func Errorf(template string, args ...interface{}) {
	log.Sugar().Errorf(template, args...)
}

func Warn(msg string, fields ...zap.Field) {
	log.Warn(msg, fields...)
}

func Warnf(template string, args ...interface{}) {
	log.Sugar().Warnf(template, args...)
}

func Info(msg string, fields ...zap.Field) {
	log.Info(msg, fields...)
}

func Infof(template string, args ...interface{}) {
	log.Sugar().Infof(template, args...)
}

func Debug(msg string, fields ...zap.Field) {
	log.Debug(msg, fields...)
}

func Debugf(template string, args ...interface{}) {
	log.Sugar().Debugf(template, args...)
}

func Trace(msg string, fields ...zap.Field) {}

func Tracef(template string, args ...interface{}) {}

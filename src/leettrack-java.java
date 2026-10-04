import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.lang.reflect.Array;
import java.util.*;

// Helpers are local to ACM jobs and never included in LeetCode submissions.
class LT {
    static final class Input {
        private final String text;
        private int position;
        Input(InputStream stream) throws IOException {
            text = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
        String next() {
            while (position < text.length() && Character.isWhitespace(text.charAt(position))) position++;
            if (position == text.length()) return null;
            if (text.charAt(position) != '"') {
                int start = position;
                while (position < text.length() && !Character.isWhitespace(text.charAt(position))) position++;
                return text.substring(start, position);
            }
            position++;
            StringBuilder token = new StringBuilder();
            while (position < text.length()) {
                char c = text.charAt(position++);
                if (c == '"') return token.toString();
                if (c == '\\') {
                    if (position == text.length()) throw new IllegalArgumentException("字符串转义不完整");
                    c = text.charAt(position++);
                }
                token.append(c);
            }
            throw new IllegalArgumentException("字符串缺少结束引号");
        }
        String required() {
            String value = next();
            if (value == null) throw new IllegalArgumentException("输入不足");
            return value;
        }
    }
    static Class<?> type(String recipe) {
        return switch (recipe.charAt(0)) {
            case 'A' -> Array.newInstance(type(recipe.substring(1)), 0).getClass();
            case 'L' -> List.class;
            case 'I' -> int.class;
            case 'J' -> long.class;
            case 'D' -> double.class;
            case 'B' -> boolean.class;
            case 'C' -> char.class;
            case 'S' -> String.class;
            default -> throw new IllegalArgumentException("未知类型");
        };
    }
    static Object read(String recipe, Input in) {
        char kind = recipe.charAt(0);
        if (kind == 'A' || kind == 'L') {
            int n = Integer.parseInt(in.required());
            if (n < 0 || n > 100000) throw new IllegalArgumentException("数组长度无效");
            String child = recipe.substring(1);
            if (kind == 'L') {
                List<Object> values = new ArrayList<>();
                for (int i = 0; i < n; i++) values.add(read(child, in));
                return values;
            }
            Object values = Array.newInstance(type(child), n);
            for (int i = 0; i < n; i++) Array.set(values, i, read(child, in));
            return values;
        }
        String value = in.required();
        return switch (kind) {
            case 'I' -> Integer.parseInt(value);
            case 'J' -> Long.parseLong(value);
            case 'D' -> Double.parseDouble(value);
            case 'B' -> {
                if (!value.equals("0") && !value.equals("1")) throw new IllegalArgumentException("布尔值须为 0 或 1");
                yield value.equals("1");
            }
            case 'C' -> {
                if (value.length() != 1) throw new IllegalArgumentException("需要一个字符");
                yield value.charAt(0);
            }
            case 'S' -> value;
            default -> throw new IllegalArgumentException("未知类型");
        };
    }
    static boolean sequence(Object value) { return value instanceof List<?> || value != null && value.getClass().isArray(); }
    static int size(Object value) { return value instanceof List<?> list ? list.size() : Array.getLength(value); }
    static Object get(Object value, int i) { return value instanceof List<?> list ? list.get(i) : Array.get(value, i); }
    static String quoted(Object value) { return "\"" + value.toString().replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
    static String output(Object value, boolean inSequence) {
        if (sequence(value)) {
            StringBuilder text = new StringBuilder();
            for (int i = 0; i < size(value); i++) {
                if (i > 0) text.append(sequence(get(value, i)) ? "\n" : " ");
                text.append(output(get(value, i), true));
            }
            return text.toString();
        }
        if (value instanceof Boolean flag) return flag ? "1" : "0";
        if (inSequence && (value instanceof String || value instanceof Character)) return quoted(value);
        return String.valueOf(value);
    }
    static void printAnswer(Object value) { System.out.println(output(value, false)); }
    static String json(Object value) {
        if (sequence(value)) {
            StringJoiner text = new StringJoiner(",", "[", "]");
            for (int i = 0; i < size(value); i++) text.add(json(get(value, i)));
            return text.toString();
        }
        if (value instanceof String || value instanceof Character) {
            StringBuilder text = new StringBuilder("\"");
            for (char c : value.toString().toCharArray()) {
                if (c == '"' || c == '\\') text.append('\\').append(c);
                else if (c < 32) text.append(String.format("\\u%04x", (int)c));
                else text.append(c);
            }
            return text.append('"').toString();
        }
        return String.valueOf(value);
    }
    static void trace(Object[] arguments) {
        try {
            Files.writeString(Path.of(System.getenv("LEETTRACK_TRACE_FILE")), json(arguments) + "\n",
                StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException error) { throw new UncheckedIOException(error); }
    }
    @SuppressWarnings({"unchecked", "rawtypes"})
    static void fill(Object target, Object seed) {
        for (int i = 0; i < size(target); i++) {
            Object value = get(seed, i % size(seed));
            if (sequence(get(target, i))) fill(get(target, i), value);
            else if (target instanceof List list) list.set(i, value);
            else Array.set(target, i, value);
        }
    }
}

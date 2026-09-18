import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class ClientJava {
    public static void main(String[] args) {
        String port = (args.length > 0) ? args[0] : "3005";
        String endpoint = "http://127.0.0.1:" + port + "/api/intent";

        String dsl = "INTENT \"java_ecosystem\" {\n"
            + "  CONTEXT { language: \"Java\", iterations: 10 }\n"
            + "  REQUIRE { BENCHMARK OPS }\n"
            + "  FLOW {\n"
            + "    SEQUENCE {\n"
            + "      BENCHMARK OPS\n"
            + "    }\n"
            + "  }\n"
            + "  OUTPUT { FORMAT \"json\" }\n"
            + "}";

        String jsonPayload = "{"
            + "\"text\":\"" + dsl.replace("\"", "\\\"").replace("\n", "\\n") + "\","
            + "\"type\":\"dsl\","
            + "\"securityContext\":{\"userId\":\"java-client-01\",\"role\":\"USER\",\"permissions\":[\"*\"]}"
            + "}";

        try {
            URL url = new URL(endpoint);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("X-Correlation-ID", "java-client-uuid-2026");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(10000);

            byte[] out = jsonPayload.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(out.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(out);
            }

            int code = conn.getResponseCode();
            BufferedReader br = new BufferedReader(new InputStreamReader(
                code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream(),
                "UTF-8"
            ));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
            br.close();

            String responseBody = sb.toString();
            boolean hasSuccess = responseBody.contains("\"success\":true");
            boolean isCompleted = responseBody.contains("\"status\":\"COMPLETED\"");

            System.out.println("{\"language\":\"Java\",\"http_status\":" + code + ",\"protocol_success\":" + hasSuccess + ",\"is_completed\":" + isCompleted + "}");
            if (code == 200 && hasSuccess && isCompleted) {
                System.exit(0);
            } else {
                System.exit(1);
            }
        } catch (Exception e) {
            System.err.println("{\"language\":\"Java\",\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
            System.exit(1);
        }
    }
}
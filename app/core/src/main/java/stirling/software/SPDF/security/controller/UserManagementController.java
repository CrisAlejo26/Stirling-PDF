package stirling.software.SPDF.security.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import lombok.RequiredArgsConstructor;

import stirling.software.SPDF.security.model.Role;
import stirling.software.SPDF.security.model.User;
import stirling.software.SPDF.security.service.UserService;

@RestController
@RequestMapping("/api/v1/admin/users")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class UserManagementController {

    private final UserService userService;

    @GetMapping
    public ResponseEntity<Map<String, Object>> listUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "") String search) {
        Page<User> result = userService.findPaged(page, size, search);
        List<Map<String, Object>> content =
                result.getContent().stream().map(this::toResponse).collect(Collectors.toList());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("content", content);
        response.put("totalElements", result.getTotalElements());
        response.put("totalPages", result.getTotalPages());
        response.put("page", result.getNumber());
        response.put("size", result.getSize());
        return ResponseEntity.ok(response);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> createUser(@RequestBody Map<String, String> body) {
        User user =
                userService.createUser(
                        body.get("name"),
                        body.get("username"),
                        body.get("loginName"),
                        body.get("password"),
                        Role.valueOf(body.get("role").toUpperCase()));
        return ResponseEntity.ok(toResponse(user));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> updateUser(
            @PathVariable String id, @RequestBody Map<String, Object> body) {
        User user =
                userService.updateUser(
                        id,
                        (String) body.get("name"),
                        (String) body.get("loginName"),
                        Role.valueOf(((String) body.get("role")).toUpperCase()),
                        Boolean.parseBoolean(body.get("enabled").toString()));
        return ResponseEntity.ok(toResponse(user));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable String id) {
        userService.deleteUser(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/reset-password")
    public ResponseEntity<?> resetPassword(
            @PathVariable String id, @RequestBody Map<String, String> body) {
        userService.changePassword(id, body.get("password"));
        return ResponseEntity.ok(Map.of("message", "Contraseña actualizada"));
    }

    private Map<String, Object> toResponse(User user) {
        java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
        map.put("id", user.getId());
        map.put("name", user.getName());
        map.put("username", user.getUsername());
        map.put("loginName", user.getLoginName() != null ? user.getLoginName() : "");
        map.put("role", user.getRole().name());
        map.put("enabled", user.isEnabled());
        map.put("createdAt", user.getCreatedAt() != null ? user.getCreatedAt().toString() : "");
        return map;
    }
}
